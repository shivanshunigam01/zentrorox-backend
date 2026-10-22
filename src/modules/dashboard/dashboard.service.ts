import { Booking, ServiceVisit, JobCard, StockBalance } from '../../models/index.js'
import type { Request } from 'express'
import type { Types } from 'mongoose'

type PopulatedVehicle = {
  registrationNo?: string
  make?: string
  model?: string
  variant?: string
} | null

type PopulatedCustomer = { name?: string } | null

type KpiListItem = {
  id: string
  title: string
  subtitle?: string
  detail?: string
  status?: string
  amount?: number
}

function mapVisitToKpiItem(sv: {
  _id: Types.ObjectId
  visitNumber?: string
  jobCardNumber?: string | null
  currentStage?: string
  vehicleId?: unknown
  customerId?: unknown
}): KpiListItem {
  const vehicle = sv.vehicleId as PopulatedVehicle
  const customer = sv.customerId as PopulatedCustomer
  const model = vehicle
    ? `${vehicle.make ?? ''} ${vehicle.model ?? ''} ${vehicle.variant ?? ''}`.trim()
    : ''
  return {
    id: sv._id.toString(),
    title: vehicle?.registrationNo ?? '—',
    subtitle: customer?.name ?? '—',
    detail: [sv.visitNumber, model, sv.jobCardNumber ? `JC ${sv.jobCardNumber}` : null]
      .filter(Boolean)
      .join(' · '),
    status: sv.currentStage,
  }
}

function mapBookingToKpiItem(b: {
  _id: Types.ObjectId
  bookingNumber?: string
  serviceType?: string | null
  preferredSlot?: string | null
  bookingDate: Date
  status: string
  customerId?: unknown
  vehicleId?: unknown
}): KpiListItem {
  const customer = b.customerId as PopulatedCustomer
  const vehicle = b.vehicleId as PopulatedVehicle
  return {
    id: b._id.toString(),
    title: customer?.name ?? '—',
    subtitle: vehicle?.registrationNo ?? '—',
    detail: [b.bookingNumber, b.serviceType, b.preferredSlot ?? b.bookingDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })]
      .filter(Boolean)
      .join(' · '),
    status: b.status,
  }
}

export async function getDashboardStats(req: Request) {
  const tenantId = req.tenantId!
  const branchId = req.branchId
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)

  const branchFilter = branchId ? { branchId } : {}

  const [
    vehiclesIn,
    todaysBookings,
    wipCount,
    awaitingApproval,
    qcPending,
    readyForDelivery,
    deliveredToday,
    bookingsToday,
    wipVehicles,
  ] = await Promise.all([
    ServiceVisit.countDocuments({
      tenantId,
      status: { $in: ['OPEN', 'IN_PROGRESS'] },
      ...branchFilter,
    }),
    Booking.countDocuments({
      tenantId,
      bookingDate: { $gte: todayStart, $lte: todayEnd },
      ...branchFilter,
    }),
    ServiceVisit.countDocuments({ tenantId, currentStage: 'WIP', ...branchFilter }),
    ServiceVisit.countDocuments({ tenantId, currentStage: 'APPROVAL', ...branchFilter }),
    ServiceVisit.countDocuments({ tenantId, currentStage: 'QC', ...branchFilter }),
    ServiceVisit.countDocuments({
      tenantId,
      currentStage: 'DELIVERY',
      status: 'IN_PROGRESS',
      ...branchFilter,
    }),
    ServiceVisit.countDocuments({
      tenantId,
      status: 'COMPLETED',
      updatedAt: { $gte: todayStart, $lte: todayEnd },
      ...branchFilter,
    }),
    Booking.find({
      tenantId,
      bookingDate: { $gte: todayStart, $lte: todayEnd },
      ...branchFilter,
    })
      .sort({ bookingDate: 1 })
      .limit(10)
      .populate('customerId', 'name')
      .populate('vehicleId', 'registrationNo make model')
      .lean(),
    ServiceVisit.find({
      tenantId,
      status: { $in: ['OPEN', 'IN_PROGRESS'] },
      ...branchFilter,
    })
      .sort({ createdAt: 1 })
      .limit(20)
      .populate('vehicleId', 'registrationNo make model variant')
      .populate('customerId', 'name')
      .lean(),
  ])

  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1)

  const [
    outstandingAgg,
    partsPending,
    revenueTodayAgg,
    mtdRevenueAgg,
    jcMonthCount,
    activeVisitsForKpi,
    bookingsTodayFull,
    partsPendingRows,
    revenueTodayRows,
  ] = await Promise.all([
    ServiceVisit.aggregate([
      { $match: { tenantId, outstanding: { $gt: 0 }, ...branchFilter } },
      { $group: { _id: null, total: { $sum: '$outstanding' } } },
    ]),
    StockBalance.countDocuments({
      tenantId,
      $expr: { $lte: ['$available', '$reorderLevel'] },
    }),
    JobCard.aggregate([
      {
        $match: {
          tenantId,
          status: 'COMPLETED',
          updatedAt: { $gte: todayStart, $lte: todayEnd },
          ...branchFilter,
        },
      },
      { $group: { _id: null, total: { $sum: { $ifNull: ['$currentValue', 0] } } } },
    ]),
    JobCard.aggregate([
      {
        $match: {
          tenantId,
          status: 'COMPLETED',
          updatedAt: { $gte: monthStart },
          ...branchFilter,
        },
      },
      { $group: { _id: null, total: { $sum: { $ifNull: ['$currentValue', 0] } } } },
    ]),
    JobCard.countDocuments({
      tenantId,
      createdAt: { $gte: monthStart },
      ...branchFilter,
    }),
    ServiceVisit.find({
      tenantId,
      status: { $in: ['OPEN', 'IN_PROGRESS'] },
      ...branchFilter,
    })
      .sort({ updatedAt: -1 })
      .limit(80)
      .populate('vehicleId', 'registrationNo make model variant')
      .populate('customerId', 'name')
      .lean(),
    Booking.find({
      tenantId,
      bookingDate: { $gte: todayStart, $lte: todayEnd },
      ...branchFilter,
    })
      .sort({ bookingDate: 1 })
      .limit(50)
      .populate('customerId', 'name')
      .populate('vehicleId', 'registrationNo make model')
      .lean(),
    StockBalance.find({
      tenantId,
      $expr: { $lte: ['$available', '$reorderLevel'] },
    })
      .populate('partId', 'partNumber name')
      .sort({ available: 1 })
      .limit(50)
      .lean(),
    JobCard.find({
      tenantId,
      status: 'COMPLETED',
      updatedAt: { $gte: todayStart, $lte: todayEnd },
      ...branchFilter,
    })
      .sort({ updatedAt: -1 })
      .limit(50)
      .populate({
        path: 'serviceVisitId',
        select: 'visitNumber',
        populate: { path: 'vehicleId', select: 'registrationNo' },
      })
      .lean(),
  ])

  const revenueToday = revenueTodayAgg[0]?.total ?? 0
  const mtdRevenue = mtdRevenueAgg[0]?.total ?? 0
  const outstanding = outstandingAgg[0]?.total ?? 0

  const visitItems = activeVisitsForKpi.map(mapVisitToKpiItem)
  const kpiDetails = {
    vehiclesIn: visitItems,
    todaysBookings: bookingsTodayFull.map(mapBookingToKpiItem),
    wip: activeVisitsForKpi.filter((sv) => sv.currentStage === 'WIP').map(mapVisitToKpiItem),
    awaitingApproval: activeVisitsForKpi.filter((sv) => sv.currentStage === 'APPROVAL').map(mapVisitToKpiItem),
    partsPending: partsPendingRows.map((row) => {
      const part = row.partId as { partNumber?: string; name?: string } | null
      return {
        id: row._id.toString(),
        title: part?.name ?? part?.partNumber ?? 'Part',
        subtitle: part?.partNumber ?? '—',
        detail: `Available ${row.available ?? 0} · Reorder at ${row.reorderLevel ?? 0}`,
        status: row.available <= 0 ? 'OUT_OF_STOCK' : 'LOW',
      }
    }),
    qcPending: activeVisitsForKpi.filter((sv) => sv.currentStage === 'QC').map(mapVisitToKpiItem),
    readyForDelivery: activeVisitsForKpi
      .filter((sv) => sv.currentStage === 'DELIVERY' && sv.status === 'IN_PROGRESS')
      .map(mapVisitToKpiItem),
    revenueToday: revenueTodayRows.map((jc) => {
      const visit = jc.serviceVisitId as {
        visitNumber?: string
        vehicleId?: PopulatedVehicle
      } | null
      const vehicle = visit?.vehicleId as PopulatedVehicle
      return {
        id: jc._id.toString(),
        title: jc.jobCardNumber ?? 'Job card',
        subtitle: vehicle?.registrationNo ?? '—',
        detail: visit?.visitNumber ?? '—',
        amount: jc.currentValue ?? 0,
        status: 'COMPLETED',
      }
    }),
  }

  return {
    kpis: {
      vehiclesIn,
      todaysBookings,
      wip: wipCount,
      awaitingApproval,
      partsPending,
      qcPending,
      readyForDelivery,
      deliveredToday,
      revenueToday,
      mtdRevenue,
      outstanding,
    },
    bookingsToday: bookingsToday.map((b) => {
      const customer = b.customerId as unknown as { name: string } | null
      const vehicle = b.vehicleId as unknown as { registrationNo: string; make: string; model: string } | null
      return {
        id: b._id.toString(),
        bookingNumber: b.bookingNumber,
        customer: customer?.name ?? '—',
        vehicle: vehicle?.registrationNo ?? '—',
        model: vehicle ? `${vehicle.make} ${vehicle.model}` : '—',
        service: b.serviceType,
        time: b.preferredSlot ?? b.bookingDate.toISOString(),
        status: b.status,
      }
    }),
    wipVehicles: wipVehicles.map((sv) => {
      const vehicle = sv.vehicleId as unknown as { registrationNo: string; make: string; model: string; variant?: string } | null
      return {
        id: sv._id.toString(),
        visitNumber: sv.visitNumber,
        registration: vehicle?.registrationNo ?? '—',
        model: vehicle ? `${vehicle.make} ${vehicle.model} ${vehicle.variant ?? ''}`.trim() : '—',
        jc: sv.jobCardNumber,
        status: sv.currentStage,
        promiseTime: sv.promiseTime,
        outstanding: sv.outstanding ?? 0,
        currentStage: sv.currentStage,
      }
    }),
    kpiDetails,
    charts: {
      revenueTrend: [
        { month: 'Apr', revenue: 820000, jobCards: 145 },
        { month: 'May', revenue: 910000, jobCards: 162 },
        { month: 'Jun', revenue: 880000, jobCards: 158 },
        { month: 'Jul', revenue: 950000, jobCards: 171 },
        { month: 'Aug', revenue: 1020000, jobCards: 185 },
        { month: 'Sep', revenue: mtdRevenue, jobCards: jcMonthCount },
      ],
      partsVsLabour: [
        { name: 'Parts', value: 58 },
        { name: 'Labour', value: 32 },
        { name: 'Consumables', value: 10 },
      ],
    },
  }
}
