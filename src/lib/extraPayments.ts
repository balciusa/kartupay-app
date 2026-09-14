export type ExtraPaymentSourceRow = {
  id: string
  title?: string | null
  amount_cents: number | null
  amount_is_per_person: boolean | null
  collection_mode: string | null
  dedicated_collector_participant_id: string | null
}

export type ExtraMembershipSourceRow = {
  extra_id: string
  participant_id: string
  left_at?: string | null
}

export type ExtraDueRow = {
  extra_id: string
  extra_title: string | null
  payer_participant_id: string
  collector_participant_id: string
  amount_cents: number
  amount_is_per_person: boolean
}

export const extraDueKey = (extraId: string, payerParticipantId: string) => `${extraId}::${payerParticipantId}`

const resolveCollectorParticipantId = (
  extra: ExtraPaymentSourceRow,
  projectCollectorParticipantId: string | null,
  activeParticipantIds: Set<string>
) => {
  const dedicatedCollectorId = extra.dedicated_collector_participant_id
  if (
    extra.collection_mode === 'dedicated_collector' &&
    dedicatedCollectorId &&
    activeParticipantIds.has(dedicatedCollectorId)
  ) {
    return dedicatedCollectorId
  }

  if (projectCollectorParticipantId && activeParticipantIds.has(projectCollectorParticipantId)) {
    return projectCollectorParticipantId
  }

  return null
}

const activeMemberIdsForExtra = (
  memberships: ExtraMembershipSourceRow[],
  extraId: string,
  activeParticipantIds: Set<string>
) => {
  const ids = new Set<string>()
  for (const membership of memberships) {
    if (membership.extra_id !== extraId) continue
    if (membership.left_at) continue
    if (!activeParticipantIds.has(membership.participant_id)) continue
    ids.add(membership.participant_id)
  }
  return Array.from(ids).sort((a, b) => a.localeCompare(b))
}

export const buildExtraDueRows = ({
  extras,
  memberships,
  activeParticipantIds,
  projectCollectorParticipantId,
}: {
  extras: ExtraPaymentSourceRow[]
  memberships: ExtraMembershipSourceRow[]
  activeParticipantIds: Set<string>
  projectCollectorParticipantId: string | null
}) => {
  const rows: ExtraDueRow[] = []

  for (const extra of extras) {
    const collectorParticipantId = resolveCollectorParticipantId(
      extra,
      projectCollectorParticipantId,
      activeParticipantIds
    )
    if (!collectorParticipantId) continue

    const memberIds = activeMemberIdsForExtra(memberships, extra.id, activeParticipantIds)
    if (memberIds.length === 0) continue

    const amountCents = Math.max(0, Number(extra.amount_cents ?? 0))
    const isPerPerson = extra.amount_is_per_person === true
    const extraTitle = extra.title ?? null

    if (isPerPerson) {
      if (amountCents <= 0) continue
      for (const memberId of memberIds) {
        rows.push({
          extra_id: extra.id,
          extra_title: extraTitle,
          payer_participant_id: memberId,
          collector_participant_id: collectorParticipantId,
          amount_cents: amountCents,
          amount_is_per_person: true,
        })
      }
      continue
    }

    const baseShare = Math.floor(amountCents / memberIds.length)
    const remainder = amountCents - baseShare * memberIds.length
    for (let index = 0; index < memberIds.length; index += 1) {
      const payerParticipantId = memberIds[index]
      const shareCents = baseShare + (index < remainder ? 1 : 0)
      if (shareCents <= 0) continue
      rows.push({
        extra_id: extra.id,
        extra_title: extraTitle,
        payer_participant_id: payerParticipantId,
        collector_participant_id: collectorParticipantId,
        amount_cents: shareCents,
        amount_is_per_person: false,
      })
    }
  }

  return rows
}

