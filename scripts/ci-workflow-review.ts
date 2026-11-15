import { describe, expect, it } from 'vitest'
import { isRecord, loadWorkflow, workflowEvent, workflowJob } from './ci-workflow-helpers.ts'

describe('Weighted approval workflow', () => {
  it('publishes from the trusted default branch after pull request and review updates', () => {
    const publisher = loadWorkflow('.github/workflows/weighted-approval.yml')
    const reviewEvent = loadWorkflow('.github/workflows/weighted-approval-review-event.yml')
    const pullRequest = workflowEvent(publisher, 'pull_request_target')
    const workflowRun = workflowEvent(publisher, 'workflow_run')
    const review = workflowEvent(reviewEvent, 'pull_request_review')
    const job = workflowJob(publisher, 'publish-status')
    const recordJob = workflowJob(reviewEvent, 'record-review-event')
    if (!isRecord(publisher.on)) throw new TypeError('weighted-approval workflow must define events')
    if (!isRecord(reviewEvent.on)) throw new TypeError('weighted-approval review event workflow must define events')
    if (!Array.isArray(job.steps)) throw new TypeError('weighted-approval job must define steps')
    if (!Array.isArray(recordJob.steps)) throw new TypeError('weighted-approval review event job must define steps')
    const steps = job.steps.filter(isRecord)
    const checkout = steps.find(step => step.name === 'Check out trusted approval policy')
    const publish = steps.find(step => step.name === 'Publish weighted approval status')
    const recordSteps = recordJob.steps.filter(isRecord)
    const record = recordSteps.find(step => step.name === 'Record review event')

    expect(publisher.name).toBe('weighted-approval')
    expect(Object.keys(publisher.on)).toEqual(['pull_request_target', 'issue_comment', 'workflow_run'])
    expect(workflowEvent(publisher, 'issue_comment').types).toEqual(['created', 'edited', 'deleted'])
    expect(pullRequest.types).toEqual(['opened', 'synchronize', 'reopened', 'ready_for_review', 'converted_to_draft', 'edited'])
    expect(workflowRun).toEqual({ workflows: ['weighted-approval-review-event'], types: ['completed'] })
    expect(reviewEvent.name).toBe('weighted-approval-review-event')
    expect(reviewEvent['run-name']).toBe('weighted-approval-review-event:${{ github.event.pull_request.number }}')
    expect(Object.keys(reviewEvent.on)).toEqual(['pull_request_review'])
    expect(review.types).toEqual(['submitted', 'edited', 'dismissed'])
    expect(reviewEvent.permissions).toEqual({})
    expect(publisher.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'write',
      statuses: 'write',
    })
    expect(publisher.concurrency).toEqual({
      group: "weighted-approval-${{ (github.event.pull_request.number || github.event.issue.number) && format('weighted-approval-review-event:{0}', github.event.pull_request.number || github.event.issue.number) || github.event.workflow_run.display_title }}",
      'cancel-in-progress': false,
    })
    expect(job).toMatchObject({
      if: "(github.event_name != 'pull_request_target' || github.event.pull_request.state == 'open') && "
        + "(github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success') && "
        + "(github.event_name != 'issue_comment' || (github.event.issue.pull_request && github.event.issue.state == 'open' &&\n"
        + "  (contains(github.event.comment.body, '/delegate') || contains(github.event.changes.body.from, '/delegate'))))",
      name: 'weighted approval publisher',
      'runs-on': 'ubuntu-latest',
      'timeout-minutes': 5,
    })
    expect(checkout).toMatchObject({
      uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
      with: {
        ref: '${{ github.event.repository.default_branch }}',
        'persist-credentials': false,
      },
    })
    const setupIndex = steps.findIndex(step => typeof step.uses === 'string' && step.uses.startsWith('actions/setup-python@'))
    expect(steps[setupIndex]?.if).toBe("steps.revoke.outputs.active == 'true'")
    expect(steps[setupIndex]?.uses).toBe('actions/setup-python@ece7cb06caefa5fff74198d8649806c4678c61a1')
    const revokeIndex = steps.findIndex(step => step.id === 'revoke')
    expect(revokeIndex).toBeGreaterThan(steps.findIndex(step => step === checkout))
    expect(revokeIndex).toBeLessThan(setupIndex)
    expect(steps[revokeIndex]?.run).toBe('node .github/review-ownership/check-approval.mjs pending')
    expect(steps.at(-1)).toMatchObject({
      if: "failure() && steps.revoke.outputs.active == 'true'",
      run: 'node .github/review-ownership/check-approval.mjs error',
    })
    const pythonJob = workflowJob(loadWorkflow('.github/workflows/ci.yml'), 'python-sdk')
    expect(pythonJob.steps).toContainEqual({
      name: 'Test production blame scoring',
      run: "uv run --python 3.10 --with-requirements .github/review-ownership/requirements.txt python -m unittest discover -s .github/review-ownership -p 'test_*.py'",
    })
    expect(steps.find(step => step.name === 'Install production lexer')).toMatchObject({
      if: "steps.revoke.outputs.active == 'true'",
      run: 'python3 -m pip install -r .github/review-ownership/requirements.txt',
    })
    expect(publish).toMatchObject({
      if: "steps.revoke.outputs.active == 'true'",
      env: {
        GITHUB_TOKEN: '${{ github.token }}',
        GITHUB_RUN_URL: '${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}',
      },
      run: 'node .github/review-ownership/check-approval.mjs',
    })
    expect(recordJob).toMatchObject({
      if: "github.event.pull_request.state == 'open'",
      name: 'record weighted approval review event',
      'runs-on': 'ubuntu-latest',
      'timeout-minutes': 2,
    })
    expect(record).toBeDefined()
    expect(record?.run).toBe("echo 'Recorded a weighted approval review event.'")
    expect(recordSteps).toHaveLength(1)
    expect(JSON.stringify(publisher)).not.toContain('github.event.pull_request.head')
    expect(JSON.stringify(publisher)).not.toContain('secrets.')
    expect(JSON.stringify(reviewEvent)).not.toContain('github.token')
    expect(JSON.stringify(reviewEvent)).not.toContain('secrets.')
  })
})

describe('Issue lifecycle workflow', () => {
  it('allocates lifecycle runners only for events that can change the board', () => {
    const lifecycle = loadWorkflow('.github/workflows/issue-lifecycle.yml')
    const policy = loadWorkflow('.github/workflows/issue-policy.yml')
    const lifecycleJob = workflowJob(lifecycle, 'lifecycle')
    if (!Array.isArray(lifecycleJob.steps)) throw new TypeError('Issue lifecycle job must define steps')

    expect(lifecycle.on).toHaveProperty('pull_request')
    expect(lifecycle.on).toHaveProperty('pull_request_review')
    expect(lifecycleJob.if).toContain("github.event.review.state == 'changes_requested'")
    expect(lifecycleJob.if).toContain('github.event.changes.body != null')
    // Keep the subscription-type gates: issue-lifecycle does not re-subscribe
    // ready_for_review (issue-policy owns that) and only reacts to submitted
    // review events.
    const lifecyclePullRequest = workflowEvent(lifecycle, 'pull_request')
    const lifecycleReview = workflowEvent(lifecycle, 'pull_request_review')
    expect(lifecyclePullRequest.types).toContain('opened')
    expect(lifecyclePullRequest.types).not.toContain('ready_for_review')
    expect(lifecyclePullRequest.types).toContain('review_requested')
    expect(lifecycleReview.types).toEqual(['submitted'])
    expect(lifecyclePullRequest.types).not.toContain('synchronize')
    expect(lifecyclePullRequest.types).not.toContain('labeled')
    expect(lifecyclePullRequest.types).not.toContain('unlabeled')
    const issueEvents = workflowEvent(lifecycle, 'issues')
    expect(issueEvents.types).not.toContain('assigned')
    expect(issueEvents.types).not.toContain('unassigned')
    expect(issueEvents.types).toContain('typed')
    expect(issueEvents.types).toContain('untyped')
    const steps = lifecycleJob.steps.filter(isRecord)
    const tokenStep = steps.find(s => s.name === 'Create project token')
    const handleStep = steps.find(s => s.name === 'Handle repository event')
    expect(tokenStep?.if).toBeUndefined()
    expect(handleStep?.if).toBeUndefined()

    // issue-policy owns PR validation; it is read-only and a real gate.
    const policyPullRequest = workflowEvent(policy, 'pull_request')
    expect(policyPullRequest.types).toContain('ready_for_review')
  })

  it('mints Project credentials only after preflight and always revalidates current metadata', () => {
    const policy = loadWorkflow('.github/workflows/issue-policy.yml')
    const policyJob = workflowJob(policy, 'policy')
    if (!Array.isArray(policyJob.steps)) throw new TypeError('Issue policy job must define steps')
    const steps = policyJob.steps.filter(isRecord)
    const tokenStep = steps.find(step => step.name === 'Create Project read token')
    const validateStep = steps.find(step => step.name === 'Validate pull request')
    const preflightStep = steps.find(step => step.id === 'preflight')
    expect(preflightStep).toMatchObject({ shell: 'bash' })
    expect(preflightStep?.run).toContain('if [ -f .github/issue-management/selective-preflight.json ]; then')
    expect(preflightStep?.run).toContain('node .github/issue-management/policy.mjs pr-preflight')
    expect(preflightStep?.if).toBeUndefined()
    expect(policyJob.if).toBeUndefined()
    expect(validateStep?.if).toBe("${{ steps.preflight.outputs.legacy-automated != 'true' }}")

    expect(tokenStep).toMatchObject({
      id: 'app-token',
      if: "${{ steps.preflight.outputs.needs-project == 'true' }}",
      uses: 'actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1',
      with: {
        'client-id': '${{ vars.DSH_ISSUE_APP_CLIENT_ID }}',
        'private-key': '${{ secrets.DSH_ISSUE_APP_PRIVATE_KEY }}',
        owner: 'deepseek-harness',
        repositories: 'deepseek-harness',
        'permission-issues': 'read',
        'permission-organization-projects': 'read',
      },
    })
    expect(validateStep).toMatchObject({
      env: {
        GITHUB_TOKEN: '${{ github.token }}',
        PROJECT_TOKEN: '${{ steps.app-token.outputs.token }}',
      },
    })
  })
})
