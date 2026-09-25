export function canManageProjectJoinRequests({
  isPublic,
  participantId,
  participantRole,
  collectorParticipantId,
}: {
  isPublic: unknown
  participantId: string | null | undefined
  participantRole: string | null | undefined
  collectorParticipantId: string | null | undefined
}) {
  if (!participantId) return false
  if (isPublic !== true) return participantRole === 'organizer'

  return participantRole === 'organizer' || participantId === collectorParticipantId
}
