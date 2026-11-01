/**
 * Containment behavior: error classification by cause, the per-step
 * containment plan (reissue with record, reroute, narrow-and-retry,
 * escalate), and verbatim preservation of the latest error body in every
 * plan — the body is never dropped.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyError, planContainment, type StepFailure,
} from '../src/containment.js'

const BODY = 'provider 400 {\n  "error": "content_policy_violation",\n  "detail": "ünïcode ✓ trace"\n}'

function failure(stepId: string, errorClass: StepFailure['errorClass'], errorBody = BODY): StepFailure {
  return { stepId, errorClass, errorBody }
}

describe('classifyError', () => {
  it('classifies a 400 with a content_policy body as content_policy', () => {
    assert.equal(
      classifyError({ status: 400, body: '{"error":{"code":"content_policy_violation"}}' }),
      'content_policy',
    )
  })

  it('classifies a 403 with safety/moderation wording as content_policy', () => {
    assert.equal(
      classifyError({ status: 403, body: 'Request blocked by the safety moderation system' }),
      'content_policy',
    )
  })

  it('classifies a status-less classifier message as content_policy', () => {
    assert.equal(
      classifyError({ message: 'rejected by the output classifier' }),
      'content_policy',
    )
  })

  it('classifies a 400 without policy wording as unknown, not policy', () => {
    assert.equal(
      classifyError({ status: 400, body: '{"error":"invalid JSON in request"}' }),
      'unknown',
    )
  })

  it('classifies 429 as rate_limit even with a body present', () => {
    assert.equal(classifyError({ status: 429, body: 'slow down' }), 'rate_limit')
  })

  it('classifies 5xx statuses as server', () => {
    assert.equal(classifyError({ status: 500 }), 'server')
    assert.equal(classifyError({ status: 503, body: 'upstream unavailable' }), 'server')
  })

  it('classifies transport error codes as network', () => {
    assert.equal(classifyError({ message: 'fetch failed: read ECONNRESET' }), 'network')
    assert.equal(classifyError({ message: 'getaddrinfo ENOTFOUND api.example' }), 'network')
  })

  it('classifies connection wording as network', () => {
    assert.equal(classifyError({ message: 'socket hang up' }), 'network')
    assert.equal(classifyError({ message: 'Connection refused by upstream' }), 'network')
  })

  it('classifies unrecognised failures as unknown', () => {
    assert.equal(classifyError({ status: 418, body: 'teapot' }), 'unknown')
    assert.equal(classifyError({}), 'unknown')
  })
})

describe('planContainment', () => {
  it('reissues with the record on a first content_policy failure', () => {
    const plan = planContainment([failure('s1', 'content_policy')])
    assert.deepEqual(plan, { kind: 'reissue-with-record', stepId: 's1', preserveErrorBody: BODY })
  })

  it('reroutes on a second content_policy failure of the same step', () => {
    const plan = planContainment([
      failure('s1', 'content_policy', 'first body'),
      failure('s1', 'content_policy'),
    ])
    assert.equal(plan.kind, 'reroute')
    assert.equal(plan.stepId, 's1')
  })

  it('escalates on a third failure of the same step, whatever the class', () => {
    assert.equal(
      planContainment([
        failure('s1', 'content_policy', 'b1'),
        failure('s1', 'content_policy', 'b2'),
        failure('s1', 'content_policy'),
      ]).kind,
      'escalate',
    )
    assert.equal(
      planContainment([
        failure('s2', 'rate_limit', 'b1'),
        failure('s2', 'server', 'b2'),
        failure('s2', 'network'),
      ]).kind,
      'escalate',
    )
  })

  it('narrows and retries rate_limit, server, network, and unknown failures', () => {
    for (const errorClass of ['rate_limit', 'server', 'network', 'unknown'] as const) {
      const plan = planContainment([failure('s1', errorClass)])
      assert.equal(plan.kind, 'narrow-and-retry', errorClass)
    }
  })

  it('still narrows and retries a second non-policy failure', () => {
    const plan = planContainment([failure('s1', 'server', 'b1'), failure('s1', 'server')])
    assert.equal(plan.kind, 'narrow-and-retry')
  })

  it('counts failures per step, not across steps', () => {
    const plan = planContainment([
      failure('s1', 'content_policy', 'other step body'),
      failure('s2', 'content_policy'),
    ])
    assert.deepEqual(plan, { kind: 'reissue-with-record', stepId: 's2', preserveErrorBody: BODY })
  })

  it('preserves the latest error body verbatim in every kind of plan', () => {
    const histories: StepFailure[][] = [
      [failure('s1', 'content_policy')],
      [failure('s1', 'content_policy', 'b1'), failure('s1', 'content_policy')],
      [failure('s1', 'rate_limit')],
      [
        failure('s1', 'server', 'b1'),
        failure('s1', 'server', 'b2'),
        failure('s1', 'server'),
      ],
    ]
    for (const history of histories) {
      assert.equal(planContainment(history).preserveErrorBody, BODY)
    }
  })

  it('uses the latest body, not an earlier one', () => {
    const plan = planContainment([
      failure('s1', 'server', 'earlier body'),
      failure('s1', 'server', 'latest body'),
    ])
    assert.equal(plan.preserveErrorBody, 'latest body')
  })

  it('escalates with empty fields on an empty history instead of retrying blind', () => {
    assert.deepEqual(planContainment([]), { kind: 'escalate', stepId: '', preserveErrorBody: '' })
  })

  it('is deterministic and does not mutate its input', () => {
    const history = [failure('s1', 'content_policy', 'b1'), failure('s1', 'content_policy')]
    const snapshot = JSON.parse(JSON.stringify(history)) as StepFailure[]
    const first = planContainment(history)
    const second = planContainment(history)
    assert.deepEqual(first, second)
    assert.deepEqual(history, snapshot)
  })
})
