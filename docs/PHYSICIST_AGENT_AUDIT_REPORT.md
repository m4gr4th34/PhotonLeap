# PhysicistAgent API — Token Efficiency Audit Report

**Principal AI Architect Review**  
**Date:** 2026-02-21  
**Scope:** agentOrchestrator.ts, AgentConsole, agent types

---

## Executive Summary

The current PhysicistAgent sends the **full optical stack + trace result** on every request, with no session awareness, no model routing, and no context compaction. This audit estimates **~72% token reduction** and **~65% cost reduction** (with hybrid routing) from the proposed refactor.

---

## 1. Current State Analysis

### 1.1 Input Token Usage (per request)

| Component | Est. Tokens | Notes |
|-----------|-------------|-------|
| PHYSICIST_SYSTEM_PROMPT | ~600 | ~2.4k chars, schema + glass library |
| optical_stack (full) | ~150–500 | 2–10 surfaces × ~80 tokens each |
| traceResult | ~80–200 | performance, gaussianBeam, focusZ |
| User prompt | ~20–100 | Variable |
| **Total per request** | **~850–1,400** | |

### 1.2 Output Token Usage (per response)

| Component | Est. Tokens | Notes |
|-----------|-------------|-------|
| surfaceDeltas (full objects) | ~100–400 | id, radius, thickness, material, etc. |
| reasoning | ~50–150 | Natural language |
| **Total per response** | **~150–550** | |

### 1.3 Typical Session (5 agent calls)

- **Input:** 5 × 1,000 ≈ **5,000 tokens**
- **Output:** 5 × 300 ≈ **1,500 tokens**
- **Total:** **~6,500 tokens/session**

---

## 2. Token Savings Estimate (Post-Refactor)

### 2.1 State-Diff (Handshake + Delta)

| Scenario | Current | Refactored | Savings |
|----------|---------|------------|---------|
| Request 1 (handshake) | 1,000 | 1,000 | 0% |
| Requests 2–5 (delta) | 4,000 | 4 × 120 ≈ 480 | **~88%** |
| **Context total** | **5,000** | **1,480** | **~70%** |

*Delta format: `{surfaces:[{id,radius?,thickness?,...}], perf:{rmsUm}}` — only changed fields.*

### 2.2 JSON Patch (RFC 6902) for Agent Response

| Scenario | Current | Refactored | Savings |
|----------|---------|------------|---------|
| 2-surface delta | ~200 tokens | ~60 tokens | **~70%** |
| 5-surface delta | ~400 tokens | ~120 tokens | **~70%** |

*Patch format: `[{"op":"replace","path":"/surfaces/0/thickness","value":8}]`*

### 2.3 Episodic Memory (3-Bullet Summary)

| Scenario | Current | Refactored | Savings |
|----------|---------|------------|---------|
| 10-message history | N/A (not implemented) | 3 bullets ≈ 50 tokens | Future-proof |
| Retry context | ~100 tokens/retry | Condensed to 1 bullet | **~80%** |

### 2.4 Small Talk Pruning

- Filtered prompts: "hello", "thanks", "ok", "describe this" (no optical intent)
- Est. **5–15 tokens saved** per filtered request
- **~10%** of prompts may be small talk → ~2% overall savings

### 2.5 Hybrid Model Routing (Brain–Body Split)

| Task Type | Model | Relative Cost | Est. % of Requests |
|-----------|-------|---------------|--------------------|
| Reasoning (optimize, zero coma, etc.) | DeepSeek-Reasoner | 1× | 30% |
| Simple (thicker lens, change material) | GPT-4o-mini / DeepSeek-Chat | ~0.05× | 70% |

**Blended cost reduction:** 0.3×1 + 0.7×0.05 ≈ **0.335** → **~65% cost savings** on API spend.

### 2.6 Invisible Thinking Logs

- **Token impact:** None (thoughts not re-sent)
- **Debug value:** Full `<think>` blocks in `thought_trace.log` for LM Studio debugging

---

## 3. Total Estimated Savings

| Metric | Before | After | Savings |
|--------|--------|-------|---------|
| Input tokens/session | ~5,000 | ~1,500 | **~70%** |
| Output tokens/session | ~1,500 | ~500 | **~67%** |
| **Total tokens/session** | **~6,500** | **~2,000** | **~69%** |
| API cost (blended) | 1× | ~0.35× | **~65%** |

---

## 4. Implementation Notes

- **Session scope:** Handshake + episodic memory lives for the lifetime of the AgentConsole (or explicit "New Session").
- **Backward compatibility:** Agent still accepts `surfaceDeltas`; JSON Patch is an alternative path. Parser accepts both.
- **Local mode:** thought_trace.log written only when LM Studio returns `<think>` content.

---

## 5. Risk Assessment

| Risk | Mitigation |
|------|-------------|
| Delta too sparse → agent misinterprets | Handshake always includes full stack; delta includes surface IDs for reference |
| JSON Patch parse errors | Fallback to `surfaceDeltas`; validate patch before apply |
| Wrong model routing | Simple heuristic (keywords); user can override model selector |
| thought_trace.log size | Append-only; rotate or truncate in config |

---

*Signed: Principal AI Architect*
