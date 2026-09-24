export function canManageProjectJoinRequests({
  participantId,
  participantRole,
  collectorParticipantId,
}: {
  participantId: string | null | undefined
  participantRole: string | null | undefined
  collectorParticipantId: string | null | undefined
}) {
  if (!participantId) return false

  return participantRole === 'organizer' || participantId === collectorParticipantId
}
