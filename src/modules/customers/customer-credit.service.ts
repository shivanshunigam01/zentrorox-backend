import type { Request } from 'express'
import { Customer, CustomerCreditProfile } from '../../models/index.js'
import { computeCreditExposure } from '../approvals/approval-policy.service.js'
import { createAuditLog } from '../../utils/audit.js'
import { ForbiddenError, NotFoundError } from '../../utils/errors.js'

export async function getCustomerCredit(req: Request, customerId: string) {
  const customer = await Customer.findOne({ _id: customerId, tenantId: req.tenantId! }).lean()
  if (!customer) throw new NotFoundError('Customer not found')
  const profile = await CustomerCreditProfile.findOne({ tenantId: req.tenantId!, customerId }).lean()
  const exposure = await computeCreditExposure(req.tenantId!, customerId)
  return { profile, exposure, legacyCreditLimit: customer.creditLimit, legacyCreditDays: customer.creditDays }
}

export async function upsertCustomerCredit(
  req: Request,
  customerId: string,
  body: {
    creditAllowed?: boolean
    creditLimit?: number
    creditPeriodDays?: number
    effectiveFrom?: string
    effectiveTo?: string
    status?: string
    remarks?: string
    creditHold?: boolean
    creditHoldReason?: string
    policyReference?: string
  },
) {
  if (!req.user?.permissions.includes('customers.credit.edit') && !req.user?.permissions.includes('customers.credit.approve')) {
    throw new ForbiddenError('Credit edit permission required')
  }
  const customer = await Customer.findOne({ _id: customerId, tenantId: req.tenantId! })
  if (!customer) throw new NotFoundError('Customer not found')

  const profile = await CustomerCreditProfile.findOneAndUpdate(
    { tenantId: req.tenantId!, customerId },
    {
      $set: {
        creditAllowed: body.creditAllowed ?? false,
        creditLimit: body.creditLimit ?? 0,
        creditPeriodDays: body.creditPeriodDays ?? 0,
        effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : new Date(),
        effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : undefined,
        status: body.status ?? (body.creditAllowed ? 'ACTIVE' : 'INACTIVE'),
        remarks: body.remarks,
        creditHold: body.creditHold ?? false,
        creditHoldReason: body.creditHoldReason,
        policyReference: body.policyReference,
        approvedBy: req.user?.permissions.includes('customers.credit.approve') ? req.user?.id : undefined,
        approvedAt: req.user?.permissions.includes('customers.credit.approve') ? new Date() : undefined,
      },
    },
    { upsert: true, new: true },
  )

  await createAuditLog({
    req,
    module: 'customers',
    action: 'CREDIT_UPDATED',
    recordId: customerId,
    newValue: body,
  })

  return profile
}
