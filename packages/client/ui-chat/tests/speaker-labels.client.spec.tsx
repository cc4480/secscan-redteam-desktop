// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AssistantMarkdown } from '../src/client/chat/AssistantMarkdown.tsx'
import { useDisclosure } from '../src/client/chat/use-disclosure.ts'
import { en } from '../src/client/locale.ts'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../src/client/contract/slots.ts'
import type { AssistantBlock } from '../src/client/contract/snapshot.ts'
import type { AssistantSpeaker } from '../src/client/contract/chat-nodes.ts'
import { useDetailedPresentation } from './presentation-fixture.client.ts'

afterEach(cleanup)

const t = ((key: string) => (en as Record<string, string>)[key] ?? key) as ChatViewSlotProps['t']
const renderMessageImages = (() => null) as ChatNodeOwnerProps['renderMessageImages']

function renderCard(props: { speaker?: AssistantSpeaker; model?: string }) {
  const blocks: readonly AssistantBlock[] = [{ kind: 'text', text: 'All checks finished.' }]
  const { container } = render(
    <AssistantMarkdown
      useDisclosure={useDisclosure}
      usePresentation={useDetailedPresentation}
      blocks={blocks}
      streaming={false}
      renderMessageImages={renderMessageImages}
      speaker={props.speaker}
      model={props.model}
      t={t}
    />,
  )
  return container.querySelector('[data-thread-item="model"]')
}

describe('Assistant speaker chip', () => {
  it('names the fleet agent and its role when a speaker is recorded', () => {
    const card = renderCard({ speaker: { name: 'NEO', role: 'exploiter' }, model: 'muse-spark-1.3' })
    expect(card?.textContent).toContain('NEO · Exploiter')
    expect(card?.textContent).not.toContain('muse-spark-1.3')
  })

  it('names the lead agent with the Lead role word', () => {
    const card = renderCard({ speaker: { name: 'MORPHEUS', role: 'lead' } })
    expect(card?.textContent).toContain('MORPHEUS · Lead')
  })

  it('falls back to the recorded model name when no speaker is recorded', () => {
    const card = renderCard({ model: 'muse-spark-1.3' })
    expect(card?.textContent).toContain('muse-spark-1.3')
    expect(card?.textContent).not.toContain('NEO')
    expect(card?.textContent).not.toContain('MORPHEUS')
  })

  it('invents no agent or model when a turn carries no identity at all', () => {
    const card = renderCard({})
    expect(card?.textContent).toContain('Model')
    expect(card?.textContent).not.toContain('NEO')
    expect(card?.textContent).not.toContain('MORPHEUS')
    expect(card?.textContent).not.toContain('OPERATOR')
    expect(card?.textContent).not.toContain('ARCHITECT')
    expect(card?.textContent).not.toContain('REPORTER')
    expect(card?.textContent).not.toContain('muse-spark')
  })
})
