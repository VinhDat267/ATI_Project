import { expect, it, describe } from 'vitest';
import {
  evaluateChecklist,
  computeSourceRevision,
  PILOT_CHECKLIST_VERSION,
} from '../src/pilot/checklist.js';
import type { SourceRow } from '../src/pilot/source.js';

const baseWebChange: SourceRow = {
  request_id: 'REQ-001',
  client_ref: 'Acme Corp',
  request_type: 'web_change',
  raw_request: 'Update landing page header copy to "New Era". See https://acme.com/home',
  deliverable: 'Website copy update on https://acme.com/home',
  due_date: '2026-10-15',
  decision_status: 'confirmed',
  source_note: 'Approved by client via email',
};

const baseDesignAsset: SourceRow = {
  request_id: 'REQ-002',
  client_ref: 'Beta Brand',
  request_type: 'design_asset',
  raw_request: 'Create Instagram banner 1080x1080 with product photo and 20% OFF badge',
  deliverable: 'Banner 1080x1080 for Instagram',
  due_date: '2026-10-20',
  decision_status: 'approved',
  source_note: 'Brand assets in drive link',
};

describe('pilot/checklist', () => {
  it('passes a fully specified web_change request', () => {
    const res = evaluateChecklist(baseWebChange);
    expect(res.status).toBe('pass');
    expect(res.missingFields).toEqual([]);
    expect(res.conflicts).toEqual([]);
    expect(res.unconfirmedBusiness).toBe(false);
    expect(res.checklistVersion).toBe(PILOT_CHECKLIST_VERSION);
    expect(typeof res.sourceRevision).toBe('string');
    expect(res.sourceRevision.length).toBe(64);
  });

  it('passes a fully specified design_asset request', () => {
    const res = evaluateChecklist(baseDesignAsset);
    expect(res.status).toBe('pass');
    expect(res.missingFields).toEqual([]);
    expect(res.unconfirmedBusiness).toBe(false);
  });

  it('detects missing or non-calendar deadline (e.g. "thứ Sáu")', () => {
    const missingDate = { ...baseWebChange, due_date: '' };
    expect(evaluateChecklist(missingDate).status).toBe('needs_input');
    expect(evaluateChecklist(missingDate).missingFields).toContain('due_date');

    const vagueDate = { ...baseWebChange, due_date: 'thứ Sáu tới' };
    expect(evaluateChecklist(vagueDate).status).toBe('needs_input');
    expect(evaluateChecklist(vagueDate).missingFields).toContain('due_date');
  });

  it('detects missing target URL for web_change', () => {
    const noUrl: SourceRow = {
      ...baseWebChange,
      raw_request: 'Update landing page header copy to "New Era"',
      deliverable: 'Landing page copy update',
      source_note: '',
    };
    const res = evaluateChecklist(noUrl);
    expect(res.status).toBe('needs_input');
    expect(res.missingFields).toContain('target_url');
  });

  it('detects missing dimensions or content for design_asset', () => {
    const noDimensions: SourceRow = {
      ...baseDesignAsset,
      raw_request: 'Create social banner for holiday sale',
      deliverable: 'Banner graphic',
    };
    const res = evaluateChecklist(noDimensions);
    expect(res.status).toBe('needs_input');
    expect(res.missingFields).toContain('dimensions');
  });

  it('flags unconfirmed business decision', () => {
    const unconfirmed = { ...baseWebChange, decision_status: 'pending client review' };
    const res = evaluateChecklist(unconfirmed);
    expect(res.unconfirmedBusiness).toBe(true);
    expect(res.status).toBe('needs_input');
    expect(res.missingFields).toContain('decision_status');
  });

  it('detects conflicting requirements when flagged in notes or raw request', () => {
    const conflicting = {
      ...baseWebChange,
      raw_request: 'Change hero background to dark blue. Or keep white as alternative? Chưa chốt màu nền.',
    };
    const res = evaluateChecklist(conflicting);
    expect(res.status).toBe('needs_input');
    expect(res.conflicts.length).toBeGreaterThan(0);
  });

  it('computes stable deterministic sourceRevision and isolates changes', () => {
    const rev1 = computeSourceRevision(baseWebChange);
    const rev2 = computeSourceRevision({ ...baseWebChange });
    expect(rev1).toBe(rev2);

    const changed = { ...baseWebChange, due_date: '2026-10-16' };
    expect(computeSourceRevision(changed)).not.toBe(rev1);

    expect(computeSourceRevision(baseWebChange, 'custom-v2')).not.toBe(rev1);
  });
});
