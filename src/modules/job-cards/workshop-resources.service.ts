import { Bay, LocationReservation, User, WorkshopLocation, WorkshopTeam, WorkAssignment } from '../../models/index.js'
import type { Request } from 'express'
import { ValidationError } from '../../utils/errors.js'

export async function listWorkshopTeams(req: Request) {
  const filter = {
    tenantId: req.tenantId!,
    isActive: true,
    ...(req.branchId && { branchId: req.branchId }),
  }
  const teams = await WorkshopTeam.find(filter).sort({ name: 1 }).lean()
  return teams.map((t) => ({
    id: t._id.toString(),
    teamCode: t.teamCode,
    name: t.name,
    specialization: t.specialization,
    memberIds: (t.memberIds ?? []).map((id) => id.toString()),
    capacity: t.capacity,
  }))
}

export async function listWorkshopLocations(req: Request) {
  const locs = await WorkshopLocation.find({
    tenantId: req.tenantId!,
    isActive: true,
    ...(req.branchId && { branchId: req.branchId }),
  }).lean()
  const bays = await Bay.find({
    tenantId: req.tenantId!,
    ...(req.branchId && { branchId: req.branchId }),
    isActive: true,
  }).lean()

  return {
    locations: locs.map((l) => ({
      id: l._id.toString(),
      code: l.code,
      name: l.name,
      locationType: l.locationType,
      operationalStatus: l.operationalStatus,
      maintenanceStatus: l.maintenanceStatus,
      bayId: l.bayId?.toString(),
    })),
    bays: bays.map((b) => ({
      id: b._id.toString(),
      code: b.code,
      name: b.name,
      bayType: b.bayType,
    })),
  }
}

export async function listEligibleEmployees(req: Request, params: { role?: string; skill?: string }) {
  const users = await User.find({
    tenantId: req.tenantId!,
    isActive: true,
    ...(req.branchId && { branchIds: { $in: [req.branchId] } }),
  }).lean()

  const activeAssignments = await WorkAssignment.countDocuments({
    tenantId: req.tenantId!,
    status: { $in: ['ASSIGNED', 'RELEASED', 'IN_PROGRESS'] },
  })

  void activeAssignments

  return users
    .filter((u) => {
      const wp = u.workshopProfile as {
        employmentStatus?: string
        availabilityStatus?: string
        primaryOperationalRole?: string
        additionalOperationalRoles?: string[]
        skillCategories?: string[]
      } | undefined
      if (wp?.employmentStatus && wp.employmentStatus !== 'ACTIVE') return false
      if (wp?.availabilityStatus === 'ON_LEAVE') return false
      if (params.role) {
        const roles = [wp?.primaryOperationalRole, ...(wp?.additionalOperationalRoles ?? [])].filter(Boolean)
        if (!roles.includes(params.role)) return false
      }
      if (params.skill && wp?.skillCategories && !wp.skillCategories.includes(params.skill)) return false
      return true
    })
    .map((u) => {
      const wp = u.workshopProfile as { designation?: string; primaryOperationalRole?: string; maxConcurrentWorkload?: number } | undefined
      return {
        id: u._id.toString(),
        employeeCode: u.employeeCode,
        name: `${u.firstName} ${u.lastName ?? ''}`.trim(),
        designation: wp?.designation,
        primaryOperationalRole: wp?.primaryOperationalRole,
        availability: (u.workshopProfile as { availabilityStatus?: string })?.availabilityStatus ?? 'AVAILABLE',
        maxConcurrentWorkload: wp?.maxConcurrentWorkload ?? 3,
      }
    })
}

export async function getLocationAvailability(req: Request, from: Date, to: Date) {
  const locations = await WorkshopLocation.find({
    tenantId: req.tenantId!,
    isActive: true,
    ...(req.branchId && { branchId: req.branchId }),
  }).lean()

  const reservations = await LocationReservation.find({
    tenantId: req.tenantId!,
    status: { $in: ['RESERVED', 'OCCUPIED'] },
    plannedStart: { $lt: to },
    plannedEnd: { $gt: from },
  }).lean()

  const byLoc = new Map<string, number>()
  for (const r of reservations) {
    const id = r.locationId.toString()
    byLoc.set(id, (byLoc.get(id) ?? 0) + 1)
  }

  return locations.map((l) => {
    const used = byLoc.get(l._id.toString()) ?? 0
    const available = l.operationalStatus === 'AVAILABLE' && l.maintenanceStatus === 'OK' && used < (l.capacity ?? 1)
    return {
      locationId: l._id.toString(),
      code: l.code,
      name: l.name,
      locationType: l.locationType,
      available,
      conflictingReservations: used,
    }
  })
}

export async function createLocationReservation(
  req: Request,
  body: {
    locationId: string
    jobCardId: string
    assignmentId?: string
    plannedStart: string
    plannedEnd: string
    remarks?: string
  },
) {
  const location = await WorkshopLocation.findOne({
    _id: body.locationId,
    tenantId: req.tenantId!,
    isActive: true,
  })
  if (!location) throw new ValidationError('Location not found')
  if (location.maintenanceStatus !== 'OK') throw new ValidationError('Location under maintenance')
  if (location.operationalStatus !== 'AVAILABLE') throw new ValidationError('Location not available')

  const start = new Date(body.plannedStart)
  const end = new Date(body.plannedEnd)
  if (end <= start) throw new ValidationError('Planned end must be after start')

  if (location.exclusiveUse) {
    const conflict = await LocationReservation.findOne({
      tenantId: req.tenantId!,
      locationId: location._id,
      status: { $in: ['RESERVED', 'OCCUPIED'] },
      plannedStart: { $lt: end },
      plannedEnd: { $gt: start },
    }).lean()
    if (conflict) throw new ValidationError('Exclusive location already reserved for this window')
  }

  const reservation = await LocationReservation.create({
    tenantId: req.tenantId!,
    branchId: location.branchId,
    locationId: location._id,
    jobCardId: body.jobCardId,
    assignmentId: body.assignmentId,
    plannedStart: start,
    plannedEnd: end,
    status: 'RESERVED',
    assignedBy: req.user?.id,
    remarks: body.remarks,
  })

  return reservation
}
