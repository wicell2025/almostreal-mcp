import { getSupabase, callEdgeFunction } from '../client.js';

export const runWorkflowSchema = {
  type: 'object',
  properties: {
    workflow_id: {
      type: 'string',
      description: 'UUID of a saved workflow in the almostreal database.',
    },
    inputs: {
      type: 'object',
      description:
        'Optional key-value overrides for Prompt Input nodes in the workflow. ' +
        'Keys are node IDs or node labels; values are prompt strings.',
      additionalProperties: { type: 'string' },
    },
  },
  required: ['workflow_id'],
} as const;

interface Args {
  workflow_id: string;
  inputs?: Record<string, string>;
}

export async function runWorkflow(args: Args): Promise<Record<string, unknown>> {
  const supabase = getSupabase();

  // Load workflow definition from the database
  const { data: workflow, error } = await supabase
    .from('workflows')
    .select('nodes, edges, name')
    .eq('id', args.workflow_id)
    .single();

  if (error || !workflow) {
    throw new Error(`Workflow ${args.workflow_id} not found: ${error?.message ?? 'no data'}`);
  }

  // Apply input overrides to PromptInput nodes
  let nodes: any[] = workflow.nodes ?? [];
  if (args.inputs) {
    nodes = nodes.map((node: any) => {
      if (node.type !== 'promptInput') return node;
      const override =
        args.inputs![node.id] ??
        args.inputs![node.data?.label] ??
        args.inputs![node.data?.name];
      if (override != null) {
        return { ...node, data: { ...node.data, text: override } };
      }
      return node;
    });
  }

  const result = await callEdgeFunction<any>('execute-workflow', {
    nodes,
    edges:       workflow.edges ?? [],
    executionId: crypto.randomUUID(),
  });

  if (!result.success) {
    throw new Error(result.error ?? 'Workflow execution failed');
  }

  return result.results ?? result;
}
