// Core types and interfaces for AI App Builder

export interface AppSpec {
  appCategory: string;
  pages: Page[];
  entities: Entity[];
  apiCapabilities: string[];
  authRequirements: AuthRequirements;
  thirdPartyIntegrations: Integration[];
  deploymentClass: DeploymentClass;
  agentRequirements: AgentRequirements;
  webDataRequirements: WebDataRequirements;
  constraints: Constraints;
  clarificationQuestions?: string[];
  isComplete?: boolean;
}

export interface Page {
  id: string;
  name: string;
  route: string;
  components: Component[];
  dataRequirements: string[];
}

export interface Component {
  id: string;
  type: string;
  props: Record<string, unknown>;
}

export interface Entity {
  name: string;
  fields: Field[];
  relationships: Relationship[];
}

export interface Field {
  name: string;
  type: string;
  required: boolean;
  constraints?: Record<string, unknown>;
}

export interface Relationship {
  target: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
  cascade?: boolean;
}

export interface AuthRequirements {
  enabled: boolean;
  providers: string[];
  protectedRoutes: string[];
}

export interface Integration {
  name: string;
  type: string;
  configuration: Record<string, unknown>;
}

export type DeploymentClass =
  | 'static-marketing'
  | 'nextjs-fullstack'
  | 'node-backend'
  | 'agent-worker'
  | 'postgres-backed';

export interface AgentRequirements {
  enabled: boolean;
  tools: string[];
  capabilities: string[];
}

export interface WebDataRequirements {
  enabled: boolean;
  sources: WebDataSource[];
  updateFrequency?: 'realtime' | 'hourly' | 'daily' | 'weekly';
}

export interface WebDataSource {
  type: 'url' | 'domain' | 'api';
  target: string;
  extractionRules?: Record<string, unknown>;
}

export interface Constraints {
  maxComplexity?: number;
  preferredLibraries?: string[];
  excludeLibraries?: string[];
  performanceRequirements?: PerformanceRequirements;
}

export interface PerformanceRequirements {
  maxLoadTime?: number;
  maxFirstContentfulPaint?: number;
  seoOptimized?: boolean;
}

// Validation Layer Types (7-Layer Model)
export type ValidationLayer =
  | 'spec-validation'
  | 'static-analysis'
  | 'dependency-checks'
  | 'property-based-testing'
  | 'contract-testing'
  | 'security-scanning'
  | 'runtime-validation';

export interface RepairResult {
  success: boolean;
  changes: Array<{ file: string; patch: string }>;
  message: string;
}

export interface ValidationResult {
  layer: ValidationLayer;
  status: 'pass' | 'fail' | 'warning';
  errors: ValidationError[];
  warnings?: ValidationWarning[];
  coverage?: number;
  duration?: number;
}

export interface ValidationError {
  code: string;
  message: string;
  file?: string;
  line?: number;
  severity: 'error' | 'critical';
  category: ErrorCategory;
}

export interface ValidationWarning {
  code: string;
  message: string;
  file?: string;
  line?: number;
  category: ErrorCategory;
}

export type ErrorCategory =
  | 'dependency'
  | 'syntax'
  | 'type'
  | 'runtime'
  | 'route'
  | 'config'
  | 'security'
  | 'testing'
  | 'contract'
  | 'unknown';

// Workflow Step types for SSE streaming
export type WorkflowStep =
  | 'spec_analyzer'
  | 'clarification_gate'
  | 'stack_planner'
  | 'repo_scaffolder'
  | 'dependency_resolver'
  | 'validator'
  | 'repair_agent'
  | 'security_gate'
  | 'deploy_agent'
  | 'observability_logger'
  | 'completion_notifier';

export type StepStatus = 'running' | 'completed' | 'failed' | 'skipped';

export interface StepUpdate {
  runId: string;
  step: WorkflowStep;
  status: StepStatus;
  message: string;
  detail?: string;
  timestamp: string;
  payload?: Record<string, unknown>;
}

// Graph State for LangGraph
export interface GraphState {
  runId: string;
  projectId: string;
  targetStack: TargetStack;
  generatedFileMap: FileMap;
  validationStatus: ValidationStatus;
  retryCount: number;
  deploymentTarget: DeploymentTarget;
  userVisibleStatus: UserVisibleStatus;
  spec?: AppSpec;
  buildPlan?: BuildPlan;
  repairAttempts: RepairAttempt[];
  secrets: SecretRequirement[];
  deploymentResult?: DeploymentResult;
  securityGateResult?: SecurityGateResult;
  errors: WorkflowError[];
  steps: WorkflowStepRecord[];
}

export interface WorkflowStepRecord {
  step: WorkflowStep;
  status: StepStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
  duration?: number;
}

export interface WorkflowError {
  step: WorkflowStep;
  message: string;
  code: string;
  recoverable: boolean;
  detail?: string;
}

export interface TargetStack {
  frontend: 'nextjs';
  backend: 'nextjs-api' | 'node';
  database: 'postgres';
  styling: 'tailwind';
  deployment: DeploymentClass;
}

export interface FileMap {
  [path: string]: {
    content: string;
    hash: string;
    generated: boolean;
  };
}

export interface ValidationStatus {
  overall: 'pending' | 'in-progress' | 'passed' | 'failed';
  layers: Partial<Record<ValidationLayer, ValidationResult>>;
}

export interface DeploymentTarget {
  type: 'local' | 'self-hosted' | 'cloud';
  platform?: string;
  configuration: Record<string, unknown>;
}

export interface DeploymentResult {
  success: boolean;
  platform: string;
  url?: string;
  logs: string[];
  error?: string;
}

export interface SecurityGateResult {
  passed: boolean;
  violations: SecurityViolation[];
  warnings: string[];
}

export interface SecurityViolation {
  code: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  file?: string;
}

export type UserVisibleStatus =
  | 'analyzing-spec'
  | 'asking-clarification'
  | 'planning'
  | 'generating'
  | 'resolving-dependencies'
  | 'validating'
  | 'repairing'
  | 'security-check'
  | 'deploying'
  | 'completed'
  | 'failed'
  | 'awaiting-input';

export interface BuildPlan {
  template: string;
  fileStructure: FileStructure;
  entityMappings: EntityMapping[];
  apiRoutes: APIRoute[];
  deploymentConfig: DeploymentConfig;
}

export interface FileStructure {
  [path: string]: {
    type: 'file' | 'directory';
    content?: string;
    children?: FileStructure;
  };
}

export interface EntityMapping {
  entity: string;
  table: string;
  fields: FieldMapping[];
}

export interface FieldMapping {
  field: string;
  column: string;
  type: string;
}

export interface APIRoute {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  handler: string;
  auth: boolean;
}

export interface DeploymentConfig {
  type: DeploymentClass;
  environment: Record<string, string>;
  buildCommands: string[];
  startCommands: string[];
}

export interface RepairAttempt {
  attemptNumber: number;
  layer: ValidationLayer;
  filesModified: string[];
  strategy: string;
  success: boolean;
  duration: number;
}

export interface SecretRequirement {
  name: string;
  description: string;
  required: boolean;
  defaultValue?: string;
}

// Web Data Layer Types
export interface WebDataExtraction {
  source: WebDataSource;
  extractedData: unknown;
  timestamp: Date;
  hash: string;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  sources: WebDataSource[];
  embeddings: unknown;
  metadata: Record<string, unknown>;
}

// Model Provider Types
export interface ModelProvider {
  name: string;
  type: 'ollama' | 'vllm' | 'tgi' | 'openai-compatible';
  endpoint?: string;
  models: Model[];
}

export interface Model {
  id: string;
  name: string;
  capabilities: ModelCapabilities;
  contextWindow: number;
  pricing?: ModelPricing;
}

export interface ModelCapabilities {
  codeGeneration: boolean;
  structuredOutput: boolean;
  functionCalling: boolean;
  streaming: boolean;
}

export interface ModelPricing {
  inputPrice: number;
  outputPrice: number;
  currency: string;
}

// Observability Types
export interface LogEntry {
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug';
  component: string;
  message: string;
  metadata?: Record<string, unknown>;
  runId?: string;
}

export interface Metric {
  name: string;
  value: number;
  timestamp: Date;
  labels: Record<string, string>;
}

export interface Trace {
  traceId: string;
  runId: string;
  startTime: Date;
  endTime?: Date;
  spans: Span[];
}

export interface Span {
  spanId: string;
  parentSpanId?: string;
  operation: string;
  startTime: Date;
  endTime?: Date;
  status: 'ok' | 'error';
  tags: Record<string, string>;
}
