import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildLegacyBasePaymentSnapshots,
  buildRefundObligations,
  outstandingRefundObligations,
  refundObligationsCompleted,
} from './projectRefund.ts'

test('refund obligations preserve each actual payment recipient', () => {
  const obligations = buildRefundObligations({
    participantId: 'payer',
    basePayments: [{ collectorParticipantId: 'project-collector', amountCents: 5000 }],
    extraPayments: [
      { collectorParticipantId: 'project-collector', amountCents: 1200, confirmed: true },
      { collectorParticipantId: 'extra-collector', amountCents: 800, confirmed: true },
      { collectorParticipantId: 'ignored', amountCents: 900, confirmed: false },
    ],
    lateTransfers: [
      { toParticipantId: 'earlier-member', amountCents: 700, received: true },
      { toParticipantId: 'ignored', amountCents: 600, received: false },
    ],
  })

  assert.deepEqual(obligations, [
    {
      collectorParticipantId: 'earlier-member',
      baseAmountCents: 0,
      extrasAmountCents: 0,
      lateTransferAmountCents: 700,
      totalAmountCents: 700,
    },
    {
      collectorParticipantId: 'extra-collector',
      baseAmountCents: 0,
      extrasAmountCents: 800,
      lateTransferAmountCents: 0,
      totalAmountCents: 800,
    },
    {
      collectorParticipantId: 'project-collector',
      baseAmountCents: 5000,
      extrasAmountCents: 1200,
      lateTransferAmountCents: 0,
      totalAmountCents: 6200,
    },
  ])
})

test('self transfers and unconfirmed signals never become refund obligations', () => {
  assert.deepEqual(buildRefundObligations({
    participantId: 'payer',
    basePayments: [{ collectorParticipantId: 'payer', amountCents: 5000 }],
    extraPayments: [
      { collectorParticipantId: 'payer', amountCents: 1200, confirmed: true },
      { collectorParticipantId: 'other', amountCents: 800, confirmed: false },
    ],
    lateTransfers: [{ toParticipantId: 'other', amountCents: 700, received: false }],
  }), [])
})

test('every current obligation requires an exactly matching completed manual refund', () => {
  const obligations = buildRefundObligations({
    participantId: 'payer',
    basePayments: [{ collectorParticipantId: 'collector', amountCents: 5000 }],
    extraPayments: [],
    lateTransfers: [{ toParticipantId: 'member', amountCents: 700, received: true }],
  })
  const complete = obligations.map(obligation => ({ ...obligation, status: 'completed' }))

  assert.equal(refundObligationsCompleted(obligations, complete), true)
  assert.equal(refundObligationsCompleted(obligations, complete.slice(0, 1)), false)
  assert.throws(() => refundObligationsCompleted(obligations, [
    { ...complete[0], totalAmountCents: complete[0].totalAmountCents + 1 },
    ...complete.slice(1),
  ]), /total does not match/)
})

test('completed refunds subtract cumulatively without changing confirmed obligations', () => {
  const obligations = buildRefundObligations({
    participantId: 'payer',
    basePayments: [{ collectorParticipantId: 'collector', amountCents: 5000 }],
    extraPayments: [{ collectorParticipantId: 'collector', amountCents: 1200, confirmed: true }],
    lateTransfers: [],
  })
  const completed = [{
    collectorParticipantId: 'collector',
    baseAmountCents: 5000,
    extrasAmountCents: 0,
    lateTransferAmountCents: 0,
    totalAmountCents: 5000,
    status: 'completed',
  }]

  assert.deepEqual(outstandingRefundObligations(obligations, completed), [{
    collectorParticipantId: 'collector',
    baseAmountCents: 0,
    extrasAmountCents: 1200,
    lateTransferAmountCents: 0,
    totalAmountCents: 1200,
  }])
  assert.equal(refundObligationsCompleted(obligations, completed), false)
})

test('excessive or recipient-mismatched refund history is rejected', () => {
  const obligations = buildRefundObligations({
    participantId: 'payer',
    basePayments: [{ collectorParticipantId: 'collector', amountCents: 5000 }],
    extraPayments: [],
    lateTransfers: [],
  })
  assert.throws(() => outstandingRefundObligations(obligations, [{
    collectorParticipantId: 'collector',
    baseAmountCents: 5001,
    extrasAmountCents: 0,
    lateTransferAmountCents: 0,
    totalAmountCents: 5001,
    status: 'completed',
  }]), /exceeds confirmed payment history/)
  assert.throws(() => outstandingRefundObligations(obligations, [{
    collectorParticipantId: 'other',
    baseAmountCents: 1,
    extrasAmountCents: 0,
    lateTransferAmountCents: 0,
    totalAmountCents: 1,
    status: 'completed',
  }]), /no matching confirmed payment recipient/)
})

test('legacy base snapshots only preserve already active or completed refund history', () => {
  const common = {
    collectorParticipantId: 'collector', baseAmountCents: 5000, extrasAmountCents: 0,
    lateTransferAmountCents: 0, totalAmountCents: 5000,
  }
  assert.deepEqual(buildLegacyBasePaymentSnapshots('payer', [
    { ...common, status: 'completed' },
    { ...common, collectorParticipantId: 'other', status: 'rejected' },
  ]), [{ collectorParticipantId: 'collector', amountCents: 5000 }])
  assert.throws(() => buildLegacyBasePaymentSnapshots('payer', [
    { ...common, status: 'completed' },
    { ...common, status: 'sent' },
  ]), /duplicate base payment amounts/)
})
