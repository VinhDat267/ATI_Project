import { describe, expect, it } from 'vitest';
import { ReportArtifactStore } from '../src/reports/artifacts.js';

describe('ReportArtifactStore bounds and TTL eviction (Task 4)', () => {
  it('bounds in-memory artifacts to MAX_ARTIFACTS (500) by evicting oldest entries', () => {
    const store = new ReportArtifactStore();
    const ids: string[] = [];

    for (let i = 0; i < 505; i++) {
      const art = store.createArtifact({
        kind: 'github_prs',
        sourceTool: 'github.list_pull_requests',
        sourceLabel: 'acme/web',
        items: [{ number: i + 1 }],
        renderedText: `Report #${i + 1}`,
        actor: { userId: 'u1', workspaceId: 'ws1' },
      });
      ids.push(art.id);
    }

    // Oldest 5 evicted, newest 500 retained
    expect(store.getArtifact(ids[0]!)).toBeUndefined();
    expect(store.getArtifact(ids[4]!)).toBeUndefined();
    expect(store.getArtifact(ids[5]!)).toBeDefined();
    expect(store.getArtifact(ids[504]!)).toBeDefined();
  });

  it('expires artifacts older than TTL_MS (2 hours) on getArtifact and verifyArtifact', () => {
    let nowMs = 1_700_000_000_000;
    const store = new ReportArtifactStore({ now: () => nowMs });

    const art = store.createArtifact({
      kind: 'jira_progress',
      sourceTool: 'myjira.search_issues',
      sourceLabel: 'ATI',
      items: [{ key: 'ATI-1' }],
      renderedText: 'Jira progress report',
      actor: { userId: 'u1', workspaceId: 'ws1' },
    });

    expect(store.getArtifact(art.id)).toBeDefined();

    // Advance clock past 2 hours (2h + 1ms)
    nowMs += 2 * 60 * 60 * 1000 + 1;

    expect(store.getArtifact(art.id)).toBeUndefined();
    const verification = store.verifyArtifact(
      {
        artifactId: art.id,
        kind: 'jira_progress',
        stepId: 's1',
        argument: 'text',
        sourceTool: 'myjira.search_issues',
        sourceLabel: 'ATI',
        readAt: art.createdAt,
        itemCount: 1,
        coverage: 'complete',
        contentHash: art.contentHash,
      },
      { userId: 'u1', workspaceId: 'ws1' },
    );
    expect(verification.valid).toBe(false);
  });
});
