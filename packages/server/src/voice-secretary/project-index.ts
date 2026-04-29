import { getDataDir } from "../config.js";
import { VoiceSecretaryKnowledgeStore } from "./knowledge-store.js";
import type { ProjectKnowledgeIndex } from "./types.js";

export class VoiceSecretaryProjectIndexStore {
  private readonly knowledgeStore: VoiceSecretaryKnowledgeStore;

  constructor(dataDir = getDataDir()) {
    this.knowledgeStore = new VoiceSecretaryKnowledgeStore(dataDir);
  }

  async getProjectIndex(projectPath: string): Promise<ProjectKnowledgeIndex> {
    const artifacts =
      await this.knowledgeStore.ensureProjectArtifacts(projectPath);
    return artifacts.index;
  }
}
