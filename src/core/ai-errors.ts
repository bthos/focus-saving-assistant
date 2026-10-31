export type AiStage = 'decision' | 'explanation';
const NAME: Record<AiStage, string> = { decision: 'Decision model', explanation: 'Explanation model' };

export function prefixStageError(stage: AiStage | undefined, message: string): string {
  if (!stage) return message;
  return message.startsWith(NAME[stage]) ? message : `${NAME[stage]}: ${message}`;
}

export function shouldClearAiError(current: string | null | undefined, stage: AiStage | undefined): boolean {
  if (!current || !stage) return true;
  return current.startsWith(NAME[stage]);
}
