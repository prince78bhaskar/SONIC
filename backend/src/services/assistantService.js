import { classifyIntent, runMasterAgent } from '../agents/masterAgent.js';
import { formatRetrievedContext, retrieveRelevantChunks } from './retrievalService.js';

export async function createAssistantReply({ content, user, history = [], documentIds }) {
  const classification = await classifyIntent(content, history);
  if (!classification.documentQuestion) return runMasterAgent(content, { classification, history });

  const studyOverview = classification.routes.some((route) => route.agent === 'study')
    && /\b(summar(?:y|ize|ise)|mcqs?|multiple.choice|quiz|important (?:exam )?questions|exams? prep|study guide|study notes)\b/i.test(content);
  const retrieval = await retrieveRelevantChunks({ userId: user._id, query: content, documentIds, allChunks: studyOverview });
  if (!retrieval.documentsAvailable) {
    return {
      content: retrieval.selectionEmpty
        ? 'Select at least one processed document to ask a document-based question.'
        : 'I couldn’t find an answer in your uploaded documents because there are no processed documents available yet. Upload a PDF or DOCX and ask again.',
      agentName: 'Master Agent',
      agentNames: ['Master Agent'],
      sources: [],
    };
  }
  if (!retrieval.chunks.length) {
    return {
      content: 'I couldn’t find this information in the uploaded documents.',
      agentName: 'Master Agent',
      agentNames: ['Master Agent'],
      sources: [],
    };
  }

  const retrievedContext = formatRetrievedContext(retrieval.chunks);
  const response = await runMasterAgent(content, {
    classification,
    retrievedContext,
    coverageNotice: retrieval.truncated
      ? `Only ${retrieval.chunks.length} of ${retrieval.totalChunkCount} selected sections were included. Clearly label the output as partial and do not imply the full documents were covered.`
      : '',
    history,
  });
  return { ...response, sources: retrieval.sources };
}
