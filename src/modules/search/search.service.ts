import { Customer, Vehicle, Booking, ServiceVisit, JobCard } from '../../models/index.js'
import type { Request } from 'express'

export async function globalSearch(req: Request, query: string) {
  const tenantId = req.tenantId!
  const branchId = req.branchId
  const q = query.trim()
  if (!q) {
    return { customers: [], vehicles: [], bookings: [], serviceVisits: [], jobCards: [] }
  }

  const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  const branchFilter = branchId ? { branchId } : {}

  const [customers, vehicles, bookings, serviceVisits, jobCards] = await Promise.all([
    Customer.find({ tenantId, isActive: true, $or: [{ name: regex }, { mobile: regex }, { code: regex }] })
      .limit(5)
      .lean(),
    Vehicle.find({
      tenantId,
      isActive: true,
      $or: [{ registrationNo: regex }, { make: regex }, { model: regex }, { vin: regex }],
    })
      .populate('customerId', 'name mobile')
      .limit(5)
      .lean(),
    Booking.find({ tenantId, ...branchFilter, bookingNumber: regex })
      .populate('customerId', 'name')
      .populate('vehicleId', 'registrationNo')
      .limit(5)
      .lean(),
    ServiceVisit.find({
      tenantId,
      ...branchFilter,
      $or: [{ visitNumber: regex }, { jobCardNumber: regex }],
    })
      .populate('vehicleId', 'registrationNo make model')
      .limit(5)
      .lean(),
    JobCard.find({ tenantId, ...branchFilter, jobCardNumber: regex })
      .populate({
        path: 'serviceVisitId',
        populate: { path: 'vehicleId', select: 'registrationNo' },
      })
      .limit(5)
      .lean(),
  ])

  return {
    customers: customers.map((c) => ({
      id: c._id.toString(),
      type: 'customer',
      label: c.name,
      sublabel: c.mobile,
      path: `/app/crm/customers/${c._id}`,
    })),
    vehicles: vehicles.map((v) => {
      const customer = v.customerId as { name?: string } | undefined
      return {
        id: v._id.toString(),
        type: 'vehicle',
        label: v.registrationNo,
        sublabel: `${v.make} ${v.model}${customer?.name ? ` · ${customer.name}` : ''}`,
        path: `/app/crm/vehicles?q=${encodeURIComponent(v.registrationNo)}`,
      }
    }),
    bookings: bookings.map((b) => {
      const customer = b.customerId as { name?: string } | undefined
      const vehicle = b.vehicleId as { registrationNo?: string } | undefined
      return {
        id: b._id.toString(),
        type: 'booking',
        label: b.bookingNumber,
        sublabel: `${customer?.name ?? '—'} · ${vehicle?.registrationNo ?? '—'}`,
        path: '/app/workshop/bookings',
      }
    }),
    serviceVisits: serviceVisits.map((sv) => {
      const vehicle = sv.vehicleId as { registrationNo?: string; make?: string; model?: string } | undefined
      return {
        id: sv._id.toString(),
        type: 'service_visit',
        label: sv.visitNumber,
        sublabel: `${vehicle?.registrationNo ?? '—'} · ${sv.currentStage.replace(/_/g, ' ')}`,
        path: `/app/service-visits/${sv._id}/wip`,
      }
    }),
    jobCards: jobCards.map((jc) => {
      const visit = jc.serviceVisitId as { vehicleId?: { registrationNo?: string } } | undefined
      return {
        id: jc._id.toString(),
        type: 'job_card',
        label: jc.jobCardNumber,
        sublabel: visit?.vehicleId?.registrationNo ?? jc.status,
        path: '/app/workshop/job-cards',
      }
    }),
  }
}
