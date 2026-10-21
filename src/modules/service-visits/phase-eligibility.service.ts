import { ReceivingRecord, ServiceVisit, VocRecord } from '../../models/index.js'
import { NotFoundError } from '../../utils/errors.js'
import type { Request } from 'express'

export type VisitPhaseState =
  | 'IN_PROGRESS'
  | 'READY_FOR_INSPECTION'
  | 'BLOCKED_EXCEPTION'
  | 'BLOCKED_INCOMPLETE'

export async function getPhaseEligibility(req: Request, visitId: string) {
  const visit = await ServiceVisit.findOne({ _id: visitId, tenantId: req.tenantId! }).lean()
  if (!visit) throw new NotFoundError('Service visit not found')

  const receiving = await ReceivingRecord.findOne({ tenantId: req.tenantId!, visitId }).lean()
  const voc = await VocRecord.findOne({ tenantId: req.tenantId!, visitId }).lean()

  const blockers: string[] = []

  if (!receiving) {
    blockers.push('RECEIVING_NOT_STARTED')
  } else if (receiving.receivingStatus === 'DRAFT' || receiving.receivingStatus === 'IN_PROGRESS') {
    blockers.push('RECEIVING_INCOMPLETE')
  } else if (receiving.receivingStatus === 'EXCEPTION') {
    blockers.push('RECEIVING_EXCEPTION')
  }

  if (!voc || voc.confirmationStatus !== 'CONFIRMED') {
    blockers.push('VOC_NOT_CONFIRMED')
  }

  const gateStagesOk = ['INVENTORY', 'VOC', 'INSPECTION', 'DIAGNOSIS'].includes(visit.currentStage)
    || (receiving?.receivingStatus === 'COMPLETED')

  if (!gateStagesOk && receiving?.receivingStatus !== 'COMPLETED') {
    blockers.push('WORKFLOW_STAGE_NOT_READY')
  }

  let state: VisitPhaseState = 'IN_PROGRESS'
  if (blockers.includes('RECEIVING_EXCEPTION')) {
    state = 'BLOCKED_EXCEPTION'
  } else if (blockers.length > 0) {
    state = 'BLOCKED_INCOMPLETE'
  } else if (
    receiving?.receivingStatus === 'COMPLETED'
    && voc?.confirmationStatus === 'CONFIRMED'
  ) {
    state = 'READY_FOR_INSPECTION'
  }

  return {
    visitId,
    currentStage: visit.currentStage,
    visitStatus: visit.status,
    phase1State: state,
    readyForInspection: state === 'READY_FOR_INSPECTION',
    blockers,
    receivingStatus: receiving?.receivingStatus ?? null,
    vocConfirmationStatus: voc?.confirmationStatus ?? null,
  }
}
