import { Workflow } from '@ai-app-builder/orchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { prompt } = (await request.json()) as { prompt?: string };

    if (!prompt || typeof prompt !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing prompt' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const workflow = new Workflow();
          
          // Collect step updates
          const stepUpdates: Array<{
            step: string;
            status: string;
            message: string;
            detail?: string;
            timestamp: string;
            payload?: Record<string, unknown>;
          }> = [];
          
          workflow.onStepUpdate((update) => {
            stepUpdates.push(update);
          });

          const state = workflow['state'];
          
          // Send initial event
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
            step: 'workflow', 
            status: 'started', 
            message: 'Workflow started', 
            runId: state.runId,
            timestamp: new Date().toISOString(),
            payload: { runId: state.runId }
          })}\n\n`));

          // Start workflow in background
          const runPromise = workflow.run(prompt);

          // Poll for updates until workflow completes
          let lastUpdateCount = 0;
          
          const pollInterval = setInterval(() => {
            while (lastUpdateCount < stepUpdates.length) {
              const update = stepUpdates[lastUpdateCount++];
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(update)}\n\n`));
              } catch {
                // Stream may be closed
              }
            }
          }, 50);

          const result = await runPromise;
          clearInterval(pollInterval);

          // Flush remaining updates
          while (lastUpdateCount < stepUpdates.length) {
            try {
              const update = stepUpdates[lastUpdateCount++];
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(update)}\n\n`));
            } catch {
              break;
            }
          }

          // Send completion with full state
          const fileMap = result.generatedFileMap || {};
          const files = Object.keys(fileMap).sort();
          
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            step: 'completion_notifier',
            status: result.userVisibleStatus === 'failed' ? 'failed' : 'completed',
            message: result.userVisibleStatus === 'failed' 
              ? 'Workflow completed with errors' 
              : 'App generation completed successfully',
            timestamp: new Date().toISOString(),
            payload: {
              runId: result.runId,
              userVisibleStatus: result.userVisibleStatus,
              fileCount: files.length,
              validationStatus: result.validationStatus?.overall,
              files,
              fileContents: fileMap,
              deployUrl: (result as any).deploymentResult?.url,
              steps: result.steps,
              errors: result.errors,
            },
          })}\n\n`));

          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error) {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              step: 'workflow',
              status: 'error',
              message: error instanceof Error ? error.message : 'Unknown error',
              timestamp: new Date().toISOString(),
            })}\n\n`));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          } catch {}
          try { controller.close(); } catch {}
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }
    );
  }
}
