import { createCloudBaseCollection } from "./cloudbase-recorder.mjs";


function copy(value) {
  return value == null ? value : structuredClone(value);
}


function filterDue(records, dueBefore) {
  if (!dueBefore) return records;
  const boundary = Date.parse(dueBefore);
  return records.filter((record) => Number.isFinite(Date.parse(record.reviewAt))
    && Date.parse(record.reviewAt) <= boundary);
}


export function createMemoryLearningStore() {
  const mastery = new Map();
  const questions = new Map();
  return {
    mastery,
    questions,
    async getMastery(masteryId) {
      return copy(mastery.get(masteryId) || null);
    },
    async upsertMastery(record) {
      mastery.set(record.masteryId, copy(record));
      return record.masteryId;
    },
    async listMasteryByParticipant(participantCode, { dueBefore, limit = 100 } = {}) {
      return filterDue(
        [...mastery.values()].filter((record) => record.participantCode === participantCode),
        dueBefore
      ).slice(0, limit).map(copy);
    },
    async getQuestion(questionId) {
      return copy(questions.get(questionId) || null);
    },
    async upsertQuestion(question) {
      questions.set(question.questionId, copy(question));
      return question.questionId;
    },
    async listQuestions({ questionKind, limit = 100 } = {}) {
      return [...questions.values()]
        .filter((question) => !questionKind || question.questionKind === questionKind)
        .slice(0, limit)
        .map(copy);
    }
  };
}


export function createCloudBaseLearningStore({
  envId,
  apiKey,
  masteryCollectionName = "learner_mastery",
  questionCollectionName = "question_bank",
  fetchImpl = fetch
}) {
  const mastery = createCloudBaseCollection({
    envId,
    apiKey,
    collectionName: masteryCollectionName,
    fetchImpl
  });
  const questions = createCloudBaseCollection({
    envId,
    apiKey,
    collectionName: questionCollectionName,
    fetchImpl
  });
  return {
    getMastery: mastery.get,
    async upsertMastery(record) {
      await mastery.upsert(record.masteryId, record);
      return record.masteryId;
    },
    async listMasteryByParticipant(participantCode, { dueBefore, limit = 100 } = {}) {
      const records = await mastery.list({ participantCode }, [], limit);
      return filterDue(records, dueBefore);
    },
    getQuestion: questions.get,
    async upsertQuestion(question) {
      await questions.upsert(question.questionId, question);
      return question.questionId;
    },
    async listQuestions({ questionKind, limit = 100 } = {}) {
      return questions.list(questionKind ? { questionKind } : {}, [], limit);
    }
  };
}
