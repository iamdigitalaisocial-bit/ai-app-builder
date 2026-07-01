import type {
  AppSpec,
  BuildPlan,
  FileMap,
  ValidationResult,
  ValidationLayer,
  GraphState,
  StepUpdate,
  WorkflowStep,
  StepStatus,
  WorkflowError,
  WorkflowStepRecord,
} from '@ai-app-builder/core';
import { createSpecEngine } from '@ai-app-builder/spec-engine';
import { createPlanner } from '@ai-app-builder/planner';
import { RepoGenerator } from '@ai-app-builder/generator';
import { createValidator } from '@ai-app-builder/validator';
import { RepairAgent } from '@ai-app-builder/repair';
import { createSecurityGate } from '@ai-app-builder/security';
import { Logger } from '@ai-app-builder/observability';

export type StepCallback = (update: StepUpdate) => void;

const MAX_TOTAL_RETRIES = 5;

export class Workflow {
  state: GraphState;
  private logger: Logger;
  private callbacks: StepCallback[] = [];

  constructor(initialState: Partial<GraphState> = {}) {
    const runId = crypto.randomUUID();
    this.logger = new Logger();
    this.state = {
      runId,
      projectId: crypto.randomUUID(),
      targetStack: {
        frontend: 'nextjs',
        backend: 'nextjs-api',
        database: 'postgres',
        styling: 'tailwind',
        deployment: 'nextjs-fullstack',
      },
      generatedFileMap: {},
      validationStatus: { overall: 'pending', layers: {} },
      retryCount: 0,
      deploymentTarget: { type: 'local', configuration: {} },
      userVisibleStatus: 'awaiting-input',
      repairAttempts: [],
      secrets: [],
      errors: [],
      steps: [],
      ...initialState,
    };
  }

  onStepUpdate(callback: StepCallback): void {
    this.callbacks.push(callback);
  }

  private emit(step: WorkflowStep, status: StepStatus, message: string, detail?: string, payload?: Record<string, unknown>): void {
    const update: StepUpdate = {
      runId: this.state.runId,
      step,
      status,
      message,
      detail,
      timestamp: new Date().toISOString(),
      payload,
    };
    for (const cb of this.callbacks) {
      try { cb(update); } catch { /* ignore callback errors */ }
    }
    this.logger.log(`step.${step}`, { status, message });
  }

  private recordStep(step: WorkflowStep, status: StepStatus, error?: string): void {
    const existing = this.state.steps.find(s => s.step === step);
    if (existing) {
      existing.status = status;
      existing.completedAt = new Date().toISOString();
      if (error) existing.error = error;
      if (existing.startedAt) existing.duration = Date.now() - new Date(existing.startedAt).getTime();
    } else {
      this.state.steps.push({
        step,
        status,
        startedAt: new Date().toISOString(),
        completedAt: status === 'running' ? undefined : new Date().toISOString(),
        error,
      });
    }
  }

  private addError(step: WorkflowStep, message: string, code: string, recoverable: boolean, detail?: string): void {
    this.state.errors.push({ step, message, code, recoverable, detail });
  }

  private async runStep<T>(
    step: WorkflowStep,
    label: string,
    fn: () => Promise<T>,
    options: { maxRetries?: number; fatal?: boolean } = {},
  ): Promise<T | null> {
    const maxRetries = options.maxRetries ?? 1;
    this.emit(step, 'running', `Starting: ${label}`);
    this.recordStep(step, 'running');
    this.state.userVisibleStatus = step.replace(/_/g, '-') as GraphState['userVisibleStatus'];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          this.emit(step, 'running', `Retry ${attempt}/${maxRetries}: ${label}`);
        }
        const result = await fn();
        this.emit(step, 'completed', `Completed: ${label}`);
        this.recordStep(step, 'completed');
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        const detail = error instanceof Error ? error.stack : undefined;

        if (attempt < maxRetries) {
          this.emit(step, 'running', `Retrying ${label}: ${message}`);
          this.logger.log(`step.${step}.retry`, { attempt, message, detail });
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        } else {
          this.emit(step, 'failed', `Failed: ${label} - ${message}`, detail);
          this.recordStep(step, 'failed', message);
          this.addError(step, message, `${step.toUpperCase()}_FAILED`, !options.fatal, detail);

          if (options.fatal) {
            this.state.userVisibleStatus = 'failed';
            throw error;
          }
          return null;
        }
      }
    }
    return null;
  }

  async run(prompt: string): Promise<GraphState> {
    this.logger.log('workflow.start', { runId: this.state.runId, prompt });
    this.emit('observability_logger', 'running', 'Workflow started', `Run ID: ${this.state.runId}`);

    // Step 1: spec_analyzer
    const spec = await this.runStep<AppSpec>(
      'spec_analyzer',
      'Analyzing your app description and generating specification',
      async () => {
        const specEngine = createSpecEngine();
        return await specEngine.generateSpec(prompt);
      },
      { maxRetries: 2 },
    );
    if (!spec) {
      this.state.userVisibleStatus = 'failed';
      return this.finalize();
    }
    this.state.spec = spec;

    // Step 2: clarification_gate
    const clarifiedSpec = await this.runStep<AppSpec>(
      'clarification_gate',
      'Checking specification completeness',
      async () => {
        const specEngine = createSpecEngine();
        const validation = await specEngine.validateSpec(spec);
        if (validation.status === 'fail') {
          const questions = await specEngine.generateClarificationQuestions(spec);
          spec.clarificationQuestions = questions;
          spec.isComplete = false;
          this.emit('clarification_gate', 'completed', 'Spec needs clarification', questions.join('\n'), { questions });
          this.state.userVisibleStatus = 'awaiting-input';
          return spec;
        }
        spec.isComplete = true;
        return spec;
      },
    );
    if (!clarifiedSpec || !clarifiedSpec.isComplete) {
      if (clarifiedSpec?.clarificationQuestions) {
        this.state.userVisibleStatus = 'awaiting-input';
        this.emit('completion_notifier', 'completed', 'Awaiting clarification from user', 
          clarifiedSpec.clarificationQuestions.join('\n'));
      }
      this.state.userVisibleStatus = 'awaiting-input';
      return this.finalize();
    }
    this.state.spec = clarifiedSpec;

    // Step 3: stack_planner
    const buildPlan = await this.runStep<BuildPlan>(
      'stack_planner',
      `Planning app structure (${spec.pages?.length || 0} pages, ${spec.entities?.length || 0} entities)`,
      async () => {
        const planner = createPlanner();
        return await planner.createBuildPlan(spec);
      },
    );
    if (!buildPlan) {
      this.state.userVisibleStatus = 'failed';
      return this.finalize();
    }
    this.state.buildPlan = buildPlan;

    // Step 4: repo_scaffolder
    const fileMap = await this.runStep<FileMap>(
      'repo_scaffolder',
      `Generating codebase (${buildPlan.entityMappings?.length || 0} entities)`,
      async () => {
        const generator = new RepoGenerator();
        // First generate from the planner's full build plan (rich file structure)
        const planFiles = await generator.generateFromPlan(spec, buildPlan);
        // Then supplement with any extra files from the simple generate path
        const specFiles = await generator.generate(spec);
        // Merge both, with planFiles taking priority
        const mergedFiles: import('@ai-app-builder/core').FileMap = { ...specFiles };
        // Copy over all plan-generated files (they have richer content)
        for (const [path, file] of Object.entries(planFiles)) {
          mergedFiles[path] = file as import('@ai-app-builder/core').FileMap[string];
        }
        return mergedFiles;
      },
      { maxRetries: 2 },
    );
    if (!fileMap || Object.keys(fileMap).length === 0) {
      this.state.userVisibleStatus = 'failed';
      this.emit('repo_scaffolder', 'failed', 'No files were generated');
      return this.finalize();
    }
    this.state.generatedFileMap = fileMap;
    this.emit('repo_scaffolder', 'completed', `Generated ${Object.keys(fileMap).length} files`, undefined, { fileCount: Object.keys(fileMap).length });

    // Step 5: dependency_resolver
    const depsResolved = await this.runStep<boolean>(
      'dependency_resolver',
      'Writing files to disk',
      async () => {
        // Files are already in memory - just confirm
        return true;
      },
    );
    if (!depsResolved) {
      this.state.userVisibleStatus = 'failed';
      return this.finalize();
    }

    // Step 6: validator
    const validationResult = await this.runStep<{ overall: string }>(
      'validator',
      'Running 7-layer validation pipeline',
      async () => {
        const validator = createValidator();
        const results = await validator.validateAllLayers(fileMap);
        const anyFail = Object.values(results).some(r => r.status === 'fail');
        const allPass = Object.values(results).every(r => r.status === 'pass');
        this.state.validationStatus = {
          overall: anyFail ? 'failed' : allPass ? 'passed' : 'in-progress',
          layers: results as Record<ValidationLayer, ValidationResult>,
        };
        return { overall: this.state.validationStatus.overall };
      },
      { maxRetries: 1 },
    );

    const hasFailures = validationResult?.overall === 'failed';

    // Step 7: repair_agent
    if (hasFailures && this.state.retryCount < MAX_TOTAL_RETRIES) {
      await this.runStep<boolean>(
        'repair_agent',
        'Attempting to fix validation failures',
        async () => {
          const repairAgent = new RepairAgent();
          const layers = this.state.validationStatus.layers as Record<string, ValidationResult>;
          const failedLayers = Object.entries(layers)
            .filter(([, r]) => r && r.status === 'fail')
            .map(([layer]) => layer as ValidationLayer);

          let allRepairsSuccessful = true;
          for (const layer of failedLayers) {
            const result = layers[layer] as ValidationResult | undefined;
            if (result) {
              const repairResult = await repairAgent.repair(result, this.state.generatedFileMap);
              if (repairResult.success) {
                this.state.repairAttempts.push({
                  attemptNumber: this.state.retryCount + 1,
                  layer,
                  filesModified: repairResult.changes.map(c => c.file),
                  strategy: 'auto-fix',
                  success: true,
                  duration: 0,
                });
                for (const change of repairResult.changes) {
                  if (change.file in this.state.generatedFileMap) {
                    this.state.generatedFileMap[change.file] = {
                      content: change.patch,
                      hash: '',
                      generated: true,
                    };
                  }
                }
              } else {
                allRepairsSuccessful = false;
              }
            }
          }
          this.state.retryCount++;

          if (allRepairsSuccessful) {
            this.emit('repair_agent', 'completed', `Applied repairs across ${failedLayers.length} layers`);
          } else {
            this.emit('repair_agent', 'completed', 'Some repairs could not be automatically fixed');
          }
          return allRepairsSuccessful;
        },
        { maxRetries: 1 },
      );
    } else if (hasFailures) {
      this.emit('repair_agent', 'failed', 'Max retry count reached. Some issues require manual intervention.');
    }

    // Step 8: security_gate
    const securityResult = await this.runStep<{ passed: boolean; violations: Array<{ severity: string }>; warnings: string[] }>(
      'security_gate',
      'Running security evaluation',
      async () => {
        const securityGate = createSecurityGate();
        const result = await securityGate.evaluate(this.state.generatedFileMap);
        (this.state as any).securityGateResult = result;
        return result;
      },
    );

    if (securityResult && !securityResult.passed) {
      const errorCount = securityResult.violations.filter(v => v.severity === 'error').length;
      this.emit('security_gate', 'completed', `Security: ${errorCount} violation(s), ${securityResult.warnings.length} warning(s)`);
    }

    // Step 9: deploy_agent
    if (this.state.validationStatus.overall !== 'failed') {
      await this.runStep<any>(
        'deploy_agent',
        'Preparing deployment',
        async () => {
          // Prepare deployment metadata and write files list
          // (Actual file writing happens in the API route layer)
          const fileCount = Object.keys(this.state.generatedFileMap).length;
          const fileList = Object.keys(this.state.generatedFileMap).sort().slice(0, 30);

          (this.state as any).deploymentResult = {
            success: true,
            platform: 'local',
            deployDir: null,
            fileCount,
            fileList,
            logs: [
              `Files generated: ${fileCount}`,
              `Files: ${fileList.slice(0, 10).join(', ')}${fileList.length > 10 ? ` and ${fileCount - 10} more` : ''}`,
              'To deploy: copy the generated files to a new project directory',
            ],
          };
          return (this.state as any).deploymentResult;
        },
        { maxRetries: 1 },
      );
    } else {
      this.emit('deploy_agent', 'skipped', 'Skipping deployment — validation failures remain');
      this.recordStep('deploy_agent', 'skipped');
    }

    // Step 10: observability_logger
    this.emit('observability_logger', 'completed', 'All steps logged', undefined, {
      runId: this.state.runId,
      totalSteps: this.state.steps.length,
      totalErrors: this.state.errors.length,
      fileCount: Object.keys(this.state.generatedFileMap).length,
    });

    // Step 11: completion_notifier
    const hadFatalErrors = this.state.errors.some(e => !e.recoverable);
    this.state.userVisibleStatus = hadFatalErrors ? 'failed' : 'completed';
    this.emit('completion_notifier', hadFatalErrors ? 'failed' : 'completed',
      hadFatalErrors ? 'Workflow completed with errors' : 'App generation completed successfully',
      undefined,
      {
        fileCount: Object.keys(this.state.generatedFileMap).length,
        validationPassed: this.state.validationStatus.overall === 'passed',
        deployUrl: (this.state as any).deploymentResult?.url,
        files: Object.keys(this.state.generatedFileMap),
        fileContents: this.state.generatedFileMap,
      });

    return this.state;
  }

  private finalize(): GraphState {
    this.emit('completion_notifier', this.state.userVisibleStatus === 'failed' ? 'failed' : 'completed',
      `Workflow ended with status: ${this.state.userVisibleStatus}`);
    return this.state;
  }
}
