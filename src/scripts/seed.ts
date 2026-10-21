import bcrypt from 'bcryptjs'
import { connectDatabase, disconnectDatabase } from '../lib/mongoose.js'
import {
  Tenant, Branch, Permission, Role, User,
  Customer, Vehicle, Bay, Warehouse, Part, StockBalance,
  Booking, ServiceVisit, JobCard, NumberingSeries, MasterData, TaxRule, DiscountPolicy, PaymentPolicy,
  WorkshopTeam, WorkshopLocation,
} from '../models/index.js'
import { SERVICE_STAGES } from '../types/enums.js'

const PERMISSIONS = [
  { module: 'dashboard', action: 'view', code: 'dashboard.view' },
  { module: 'bookings', action: 'view', code: 'bookings.view' },
  { module: 'bookings', action: 'create', code: 'bookings.create' },
  { module: 'bookings', action: 'edit', code: 'bookings.edit' },
  { module: 'service_visits', action: 'view', code: 'service_visits.view' },
  { module: 'service_visits', action: 'edit', code: 'service_visits.edit' },
  { module: 'estimates', action: 'view', code: 'estimates.view' },
  { module: 'estimates', action: 'create', code: 'estimates.create' },
  { module: 'estimates', action: 'approve', code: 'estimates.approve' },
  { module: 'job_cards', action: 'view', code: 'job_cards.view' },
  { module: 'job_cards', action: 'edit', code: 'job_cards.edit' },
  { module: 'inventory', action: 'view', code: 'inventory.view' },
  { module: 'inventory', action: 'issue', code: 'inventory.issue' },
  { module: 'billing', action: 'view', code: 'billing.view' },
  { module: 'billing', action: 'create', code: 'billing.create' },
  { module: 'crm', action: 'view', code: 'crm.view' },
  { module: 'crm', action: 'edit', code: 'crm.edit' },
  { module: 'reports', action: 'view', code: 'reports.view' },
  { module: 'reports', action: 'export', code: 'reports.export' },
  { module: 'admin', action: 'view', code: 'admin.view' },
  { module: 'admin', action: 'edit', code: 'admin.edit' },
  { module: 'masters', action: 'view', code: 'masters.view' },
  { module: 'masters', action: 'edit', code: 'masters.edit' },
  { module: 'inspections', action: 'view', code: 'inspections.view' },
  { module: 'inspections', action: 'edit', code: 'inspections.edit' },
  { module: 'inspections', action: 'review', code: 'inspections.review' },
  { module: 'approvals', action: 'view', code: 'approvals.view' },
  { module: 'approvals', action: 'record', code: 'approvals.record' },
  { module: 'approvals', action: 'job_card_authorize', code: 'approvals.job_card_authorize' },
  { module: 'payments', action: 'view', code: 'payments.view' },
  { module: 'payments', action: 'record', code: 'payments.record' },
  { module: 'payments', action: 'verify', code: 'payments.verify' },
  { module: 'payments', action: 'reverse', code: 'payments.reverse' },
  { module: 'payments', action: 'share', code: 'payments.share' },
  { module: 'customers', action: 'credit_view', code: 'customers.credit.view' },
  { module: 'customers', action: 'credit_edit', code: 'customers.credit.edit' },
  { module: 'customers', action: 'credit_approve', code: 'customers.credit.approve' },
  { module: 'financial_auth', action: 'exception', code: 'financial_auth.exception' },
  { module: 'job_cards', action: 'view', code: 'job_cards.view' },
  { module: 'job_cards', action: 'create', code: 'job_cards.create' },
  { module: 'job_cards', action: 'assign', code: 'job_cards.assign' },
  { module: 'job_cards', action: 'reassign', code: 'job_cards.reassign' },
  { module: 'job_cards', action: 'release', code: 'job_cards.release' },
  { module: 'job_cards', action: 'print', code: 'job_cards.print' },
  { module: 'workshop_teams', action: 'manage', code: 'workshop_teams.manage' },
  { module: 'workshop_locations', action: 'manage', code: 'workshop_locations.manage' },
  { module: 'delivery', action: 'create', code: 'delivery_commitments.create' },
  { module: 'delivery', action: 'revise', code: 'delivery_commitments.revise' },
  { module: 'wip', action: 'view', code: 'wip.view' },
  { module: 'wip', action: 'start', code: 'wip.start' },
  { module: 'wip', action: 'update', code: 'wip.update' },
  { module: 'wip', action: 'complete', code: 'wip.complete' },
  { module: 'wip', action: 'verify', code: 'wip.verify' },
  { module: 'wip', action: 'raise_additional_work', code: 'wip.raise_additional_work' },
  { module: 'wip', action: 'release_qc', code: 'wip.release_qc' },
  { module: 'parts_requisitions', action: 'create', code: 'parts_requisitions.create' },
  { module: 'parts_requisitions', action: 'approve', code: 'parts_requisitions.approve' },
  { module: 'inventory', action: 'return', code: 'inventory.return' },
  { module: 'inventory', action: 'adjust', code: 'inventory.adjust' },
  { module: 'supplementary_estimates', action: 'create', code: 'supplementary_estimates.create' },
  { module: 'job_cards', action: 'revise', code: 'job_cards.revise' },
  { module: 'qc', action: 'view', code: 'qc.view' },
  { module: 'qc', action: 'assign', code: 'qc.assign' },
  { module: 'qc', action: 'start', code: 'qc.start' },
  { module: 'qc', action: 'edit', code: 'qc.edit' },
  { module: 'qc', action: 'submit', code: 'qc.submit' },
  { module: 'qc', action: 'pass', code: 'qc.pass' },
  { module: 'qc', action: 'fail', code: 'qc.fail' },
  { module: 'qc', action: 'rework', code: 'qc.rework' },
  { module: 'qc', action: 'print', code: 'qc.print' },
  { module: 'qc', action: 'release_invoice', code: 'qc.release_invoice' },
  { module: 'billing', action: 'issue', code: 'billing.issue' },
  { module: 'gate_pass', action: 'issue', code: 'gate_pass.issue' },
  { module: 'deliveries', action: 'complete', code: 'deliveries.complete' },
  { module: 'feedback', action: 'create', code: 'feedback.create' },
]

const MASTER_SEED = [
  { category: 'SERVICE_TYPE', code: 'PERIODIC_SERVICE', label: 'Periodic Service', sortOrder: 1 },
  { category: 'SERVICE_TYPE', code: 'AC_SERVICE', label: 'AC Service', sortOrder: 2 },
  { category: 'SERVICE_TYPE', code: 'BRAKE_INSPECTION', label: 'Brake Inspection', sortOrder: 3 },
  { category: 'SERVICE_TYPE', code: 'GENERAL_REPAIR', label: 'General Repair', sortOrder: 4 },
  { category: 'VEHICLE_MAKE', code: 'HONDA', label: 'Honda', sortOrder: 1 },
  { category: 'VEHICLE_MAKE', code: 'HYUNDAI', label: 'Hyundai', sortOrder: 2 },
  { category: 'VEHICLE_MAKE', code: 'MARUTI', label: 'Maruti Suzuki', sortOrder: 3 },
  { category: 'VEHICLE_MAKE', code: 'TOYOTA', label: 'Toyota', sortOrder: 4 },
  { category: 'VEHICLE_MAKE', code: 'TATA', label: 'Tata', sortOrder: 5 },
  { category: 'VEHICLE_MODEL', code: 'CITY', label: 'City', parentCode: 'HONDA', sortOrder: 1 },
  { category: 'VEHICLE_MODEL', code: 'CRETA', label: 'Creta', parentCode: 'HYUNDAI', sortOrder: 1 },
  { category: 'VEHICLE_MODEL', code: 'SWIFT', label: 'Swift', parentCode: 'MARUTI', sortOrder: 1 },
  { category: 'VEHICLE_MODEL', code: 'INNOVA_CRYSTA', label: 'Innova Crysta', parentCode: 'TOYOTA', sortOrder: 1 },
  { category: 'VEHICLE_MODEL', code: 'NEXON', label: 'Nexon', parentCode: 'TATA', sortOrder: 1 },
  { category: 'FUEL_TYPE', code: 'PETROL', label: 'Petrol', sortOrder: 1 },
  { category: 'FUEL_TYPE', code: 'DIESEL', label: 'Diesel', sortOrder: 2 },
  { category: 'FUEL_TYPE', code: 'CNG', label: 'CNG', sortOrder: 3 },
  { category: 'FUEL_TYPE', code: 'ELECTRIC', label: 'Electric', sortOrder: 4 },
  { category: 'BAY_TYPE', code: 'GENERAL_REPAIR', label: 'General Repair', sortOrder: 1 },
  { category: 'BAY_TYPE', code: 'QUICK_SERVICE', label: 'Quick Service', sortOrder: 2 },
  { category: 'BAY_TYPE', code: 'AC', label: 'AC Bay', sortOrder: 3 },
  { category: 'BAY_TYPE', code: 'DIAGNOSTIC', label: 'Diagnostic', sortOrder: 4 },
  { category: 'JOB_TYPE', code: 'GENERAL_REPAIR', label: 'General Repair', sortOrder: 1 },
  { category: 'JOB_TYPE', code: 'WARRANTY', label: 'Warranty', sortOrder: 2 },
  { category: 'JOB_TYPE', code: 'ACCIDENT', label: 'Accident Repair', sortOrder: 3 },
  { category: 'BOOKING_SOURCE', code: 'WALK_IN', label: 'Walk-in', sortOrder: 1 },
  { category: 'BOOKING_SOURCE', code: 'PHONE', label: 'Phone', sortOrder: 2 },
  { category: 'BOOKING_SOURCE', code: 'WHATSAPP', label: 'WhatsApp', sortOrder: 3 },
  { category: 'BOOKING_SOURCE', code: 'WEBSITE', label: 'Website', sortOrder: 4 },
  { category: 'APPROVAL_SOURCE', code: 'IN_PERSON', label: 'In person', sortOrder: 1 },
  { category: 'APPROVAL_SOURCE', code: 'PHONE_CALL', label: 'Phone call', sortOrder: 2 },
  { category: 'APPROVAL_SOURCE', code: 'WHATSAPP', label: 'WhatsApp', sortOrder: 3 },
  { category: 'APPROVAL_SOURCE', code: 'EMAIL', label: 'Email', sortOrder: 4 },
  { category: 'APPROVAL_SOURCE', code: 'CUSTOMER_PORTAL', label: 'Customer portal', sortOrder: 5 },
  { category: 'APPROVAL_SOURCE', code: 'SIGNED_DOCUMENT', label: 'Signed document', sortOrder: 6 },
  { category: 'APPROVAL_SOURCE', code: 'OTHER', label: 'Other', sortOrder: 7 },
  { category: 'PAYMENT_MODE', code: 'CASH', label: 'Cash', sortOrder: 1 },
  { category: 'PAYMENT_MODE', code: 'UPI', label: 'UPI', sortOrder: 2 },
  { category: 'PAYMENT_MODE', code: 'CARD', label: 'Card', sortOrder: 3 },
  { category: 'PAYMENT_MODE', code: 'CREDIT', label: 'Credit / Outstanding', sortOrder: 4 },
  { category: 'COMPLAINT_TYPE', code: 'ENGINE', label: 'Engine', sortOrder: 1 },
  { category: 'COMPLAINT_TYPE', code: 'BRAKES', label: 'Brakes', sortOrder: 2 },
  { category: 'COMPLAINT_TYPE', code: 'AC', label: 'AC / Cooling', sortOrder: 3 },
  { category: 'COMPLAINT_TYPE', code: 'ELECTRICAL', label: 'Electrical', sortOrder: 4 },
  { category: 'INVENTORY_DOCUMENT', code: 'RC', label: 'Registration Certificate', sortOrder: 1 },
  { category: 'INVENTORY_DOCUMENT', code: 'INSURANCE', label: 'Insurance Copy', sortOrder: 2 },
  { category: 'INVENTORY_KEY', code: 'PRIMARY_KEY', label: 'Primary Key', sortOrder: 1 },
  { category: 'INVENTORY_KEY', code: 'SPARE_KEY', label: 'Spare Key', sortOrder: 2 },
  { category: 'INVENTORY_TOOL', code: 'JACK_TOOLKIT', label: 'Jack & Tool Kit', sortOrder: 1 },
  { category: 'INVENTORY_ACCESSORY', code: 'FLOOR_MATS', label: 'Floor Mats', sortOrder: 1 },
  { category: 'INVENTORY_ACCESSORY', code: 'MUSIC_SYSTEM', label: 'Music System / Infotainment', sortOrder: 2 },
  { category: 'INSPECTION_ITEM', code: 'ENG_OIL', label: 'Engine oil level & condition', parentCode: 'Engine', sortOrder: 1, metadata: { method: 'Visual', inputType: 'dropdown' } },
  { category: 'INSPECTION_ITEM', code: 'BRK_PAD', label: 'Brake pad thickness', parentCode: 'Braking', sortOrder: 2, metadata: { method: 'Visual', required: true } },
  { category: 'INSPECTION_ITEM', code: 'TYRE', label: 'Tyre tread & damage', parentCode: 'Tyres / Wheels', sortOrder: 3, metadata: { method: 'Visual' } },
  { category: 'VEHICLE_CATEGORY', code: 'PASSENGER_CAR', label: 'Passenger Car', sortOrder: 1 },
  { category: 'VEHICLE_CATEGORY', code: 'SUV', label: 'SUV', sortOrder: 2 },
]

async function main() {
  console.log('🌱 Seeding ZentroSure MongoDB...\n')
  await connectDatabase()

  for (const p of PERMISSIONS) {
    await Permission.updateOne({ code: p.code }, { $setOnInsert: p }, { upsert: true })
  }
  const allPermissions = await Permission.find().lean()
  console.log(`✓ ${allPermissions.length} permissions`)

  const allPermCodes = allPermissions.map((p) => p.code)
  let superAdminRole = await Role.findOne({ code: 'SUPER_ADMIN', tenantId: null })
  if (!superAdminRole) {
    superAdminRole = await Role.create({
      name: 'ZentroSure Super Admin',
      code: 'SUPER_ADMIN',
      description: 'Platform-level super administrator',
      isSystem: true,
      permissionCodes: allPermCodes,
    })
  } else {
    await Role.updateOne({ _id: superAdminRole._id }, { $set: { permissionCodes: allPermCodes } })
  }

  const passwordHash = await bcrypt.hash('demo1234', 12)

  let tenant = await Tenant.findOne({ code: 'DEMO-MOTORS' })
  if (!tenant) {
    tenant = await Tenant.create({
      code: 'DEMO-MOTORS',
      name: 'ZENTROROX Demo Motors Pvt. Ltd.',
      legalName: 'ZENTROROX Demo Motors Private Limited',
      gstin: '10AABCD1234E1Z5',
      email: 'info@demomotors.com',
      phone: '+91 612 234 5678',
      address: 'Fraser Road',
      city: 'Patna',
      state: 'Bihar',
      pin: '800001',
      plan: 'professional',
      status: 'ACTIVE',
    })
  } else {
    await Tenant.updateOne(
      { _id: tenant._id },
      {
        name: 'ZENTROROX Demo Motors Pvt. Ltd.',
        legalName: 'ZENTROROX Demo Motors Private Limited',
      },
    )
    tenant.name = 'ZENTROROX Demo Motors Pvt. Ltd.'
    tenant.legalName = 'ZENTROROX Demo Motors Private Limited'
  }
  console.log(`✓ Tenant: ${tenant.name}`)

  const branchDefs = [
    { code: 'PAT-01', name: 'Patna Central Workshop', city: 'Patna', state: 'Bihar' },
    { code: 'MUZ-01', name: 'Muzaffarpur Workshop', city: 'Muzaffarpur', state: 'Bihar' },
    { code: 'RAN-01', name: 'Ranchi Workshop', city: 'Ranchi', state: 'Jharkhand' },
  ]

  const branches = []
  for (const b of branchDefs) {
    let branch = await Branch.findOne({ tenantId: tenant._id, code: b.code })
    if (!branch) {
      branch = await Branch.create({ tenantId: tenant._id, ...b })
    }
    branches.push(branch)
  }
  console.log(`✓ ${branches.length} branches`)

  const seriesModules = [
    { module: 'BOOKING', prefix: 'SB' },
    { module: 'SERVICE_VISIT', prefix: 'SV' },
    { module: 'CUSTOMER', prefix: 'CUS' },
    { module: 'JOB_CARD', prefix: 'JC' },
    { module: 'INSPECTION', prefix: 'INSP' },
    { module: 'ESTIMATE', prefix: 'EST' },
    { module: 'CUSTOMER_APPROVAL', prefix: 'APR' },
    { module: 'ADVANCE_PAYMENT', prefix: 'ADV' },
    { module: 'RECEIPT', prefix: 'RCP' },
    { module: 'PARTS_REQUISITION', prefix: 'PR' },
    { module: 'STOCK_ISSUE', prefix: 'SI' },
    { module: 'STOCK_RETURN', prefix: 'SR' },
    { module: 'ADDITIONAL_WORK', prefix: 'AWR' },
    { module: 'QUALITY_CONTROL', prefix: 'QC' },
    { module: 'QC_REWORK', prefix: 'QRW' },
    { module: 'FINAL_INVOICE', prefix: 'INV' },
    { module: 'CREDIT_NOTE', prefix: 'CN' },
    { module: 'GATE_PASS', prefix: 'GP' },
    { module: 'INVOICE_PAYMENT', prefix: 'IPAY' },
  ]
  for (const s of seriesModules) {
    await NumberingSeries.updateOne(
      { tenantId: tenant._id, module: s.module },
      { $setOnInsert: { tenantId: tenant._id, ...s, currentNo: 40, padLength: 6 } },
      { upsert: true },
    )
  }

  const roleDefs = [
    { code: 'OWNER', name: 'Owner', perms: allPermCodes },
    { code: 'WORKSHOP_MANAGER', name: 'Workshop Manager', perms: allPermCodes },
    {
      code: 'WORKSHOP_EXECUTIVE',
      name: 'Workshop Executive',
      perms: [
        'dashboard.view',
        'service_visits.view',
        'inspections.view', 'inspections.edit',
        'job_cards.view', 'job_cards.create', 'job_cards.assign', 'job_cards.release', 'job_cards.print',
        'wip.view', 'qc.view',
        'delivery_commitments.create', 'delivery_commitments.revise',
        'approvals.view',
      ],
    },
    {
      code: 'SERVICE_ADVISOR',
      name: 'Service Advisor',
      perms: [
        'dashboard.view',
        'bookings.view', 'bookings.create', 'bookings.edit',
        'service_visits.view', 'service_visits.edit',
        'inspections.view', 'inspections.edit',
        'estimates.view', 'estimates.create',
        'approvals.view', 'approvals.record',
        'payments.view', 'payments.record', 'payments.share',
        'customers.credit.view',
        'job_cards.view', 'job_cards.create',
        'wip.view', 'qc.view',
        'billing.view',
        'crm.view', 'crm.edit',
      ],
    },
    { code: 'INSPECTOR', name: 'Inspector', perms: ['dashboard.view', 'service_visits.view', 'inspections.view', 'inspections.edit', 'qc.view', 'qc.start', 'qc.edit', 'qc.submit', 'qc.pass', 'qc.fail', 'qc.rework', 'qc.print', 'job_cards.view', 'wip.view'] },
    { code: 'TECHNICIAN', name: 'Technician', perms: ['dashboard.view', 'service_visits.view', 'job_cards.view', 'wip.view', 'wip.update', 'wip.complete', 'wip.raise_additional_work', 'parts_requisitions.create', 'inventory.view', 'inspections.view', 'inspections.edit'] },
    { code: 'PARTS_MANAGER', name: 'Parts Manager', perms: ['dashboard.view', 'inventory.view', 'inventory.issue', 'inventory.return', 'parts_requisitions.approve', 'parts_requisitions.create', 'reports.view'] },
    { code: 'CASHIER', name: 'Cashier', perms: ['dashboard.view', 'billing.view', 'billing.create', 'payments.view', 'payments.record', 'payments.verify', 'payments.share', 'approvals.view'] },
    { code: 'CRM_EXECUTIVE', name: 'CRM Executive', perms: ['dashboard.view', 'crm.view', 'crm.edit', 'bookings.view'] },
  ]

  const roles: Record<string, string> = {}
  for (const rd of roleDefs) {
    let role = await Role.findOne({ tenantId: tenant._id, code: rd.code })
    if (!role) {
      role = await Role.create({
        tenantId: tenant._id,
        name: rd.name,
        code: rd.code,
        isSystem: true,
        permissionCodes: rd.perms,
      })
    } else {
      await Role.updateOne(
        { _id: role._id },
        { $set: { name: rd.name, permissionCodes: rd.perms, isSystem: true } },
      )
    }
    roles[rd.code] = role._id.toString()
  }
  console.log(`✓ ${roleDefs.length} roles`)

  const userDefs = [
    { email: 'rajesh@demomotors.com', firstName: 'Rajesh', lastName: 'Kumar', role: 'WORKSHOP_MANAGER' },
    { email: 'priya@demomotors.com', firstName: 'Priya', lastName: 'Singh', role: 'SERVICE_ADVISOR' },
    { email: 'ravi@demomotors.com', firstName: 'Ravi', lastName: 'Mehta', role: 'TECHNICIAN' },
    { email: 'anil@demomotors.com', firstName: 'Anil', lastName: 'Verma', role: 'PARTS_MANAGER' },
    { email: 'sunita@demomotors.com', firstName: 'Sunita', lastName: 'Devi', role: 'CASHIER' },
    { email: 'kavita@demomotors.com', firstName: 'Kavita', lastName: 'Sharma', role: 'CRM_EXECUTIVE' },
    { email: 'superadmin@zentrosure.com', firstName: 'Super', lastName: 'Admin', role: null, isPlatformAdmin: true },
  ]

  for (const u of userDefs) {
    await User.updateOne(
      { tenantId: tenant._id, email: u.email },
      {
        $set: {
          passwordHash,
          firstName: u.firstName,
          lastName: u.lastName,
          roleId: u.role ? roles[u.role] : superAdminRole._id,
          branchIds: u.isPlatformAdmin ? [] : branches.map((b) => b._id),
          isPlatformAdmin: u.isPlatformAdmin ?? false,
          isActive: true,
        },
        $setOnInsert: { tenantId: tenant._id, email: u.email },
      },
      { upsert: true },
    )
  }
  console.log(`✓ ${userDefs.length} demo users (password: demo1234)`)

  const customerData = [
    { code: 'CUS-00001', name: 'Amit Sharma', mobile: '9876543210', email: 'amit@email.com', type: 'INDIVIDUAL', city: 'Patna' },
    { code: 'CUS-00002', name: 'Fleet Solutions Pvt Ltd', mobile: '9123456789', email: 'fleet@company.com', type: 'FLEET', city: 'Patna' },
    { code: 'CUS-00003', name: 'Neha Gupta', mobile: '9988776655', email: 'neha@email.com', type: 'INDIVIDUAL', city: 'Muzaffarpur' },
    { code: 'CUS-00004', name: 'Vikram Patel', mobile: '9876512345', email: 'vikram@email.com', type: 'INDIVIDUAL', city: 'Patna' },
    { code: 'CUS-00005', name: 'Sanjay Mishra', mobile: '8765432109', type: 'INDIVIDUAL', city: 'Ranchi' },
  ]

  const customers = []
  for (const c of customerData) {
    let customer = await Customer.findOne({ tenantId: tenant._id, code: c.code })
    if (!customer) {
      customer = await Customer.create({ tenantId: tenant._id, ...c })
    }
    customers.push(customer)
  }
  console.log(`✓ ${customers.length} customers`)

  const vehicleData = [
    { customerId: customers[0]._id, registrationNo: 'BR 01 AB 4521', make: 'Honda', model: 'City', variant: 'VX CVT', fuelType: 'Petrol', manufacturingYear: 2021, odometer: 45230, vin: 'MAHFR2WK5K1234567', engineNo: 'L15Z1-7890123' },
    { customerId: customers[0]._id, registrationNo: 'BR 02 CD 7890', make: 'Hyundai', model: 'Creta', variant: 'SX', fuelType: 'Diesel', manufacturingYear: 2022, odometer: 32100 },
    { customerId: customers[2]._id, registrationNo: 'BR 06 KL 3456', make: 'Maruti', model: 'Swift', variant: 'VDI', fuelType: 'Diesel', manufacturingYear: 2020, odometer: 67800 },
    { customerId: customers[3]._id, registrationNo: 'BR 05 IJ 9012', make: 'Toyota', model: 'Innova Crysta', variant: '2.4 ZX', fuelType: 'Diesel', manufacturingYear: 2019, odometer: 89500 },
    { customerId: customers[4]._id, registrationNo: 'BR 07 MN 7890', make: 'Tata', model: 'Nexon', variant: 'XZ+', fuelType: 'Electric', manufacturingYear: 2023, odometer: 12400 },
  ]

  const vehicles = []
  for (const v of vehicleData) {
    let vehicle = await Vehicle.findOne({ tenantId: tenant._id, registrationNo: v.registrationNo })
    if (!vehicle) {
      vehicle = await Vehicle.create({ tenantId: tenant._id, ...v })
    }
    vehicles.push(vehicle)
  }
  console.log(`✓ ${vehicles.length} vehicles`)

  const bayTypes = ['General Repair', 'Quick Service', 'Electrical', 'AC', 'Washing', 'Diagnostic']
  const bays = []
  for (let i = 0; i < bayTypes.length; i++) {
    let bay = await Bay.findOne({ tenantId: tenant._id, branchId: branches[0]._id, code: `BAY-${i + 1}` })
    if (!bay) {
      bay = await Bay.create({
        tenantId: tenant._id,
        branchId: branches[0]._id,
        code: `BAY-${i + 1}`,
        name: `Bay ${i + 1}`,
        bayType: bayTypes[i],
      })
    }
    bays.push(bay)
  }
  console.log(`✓ ${bays.length} bays`)

  let warehouse = await Warehouse.findOne({ tenantId: tenant._id, code: 'WH-MAIN' })
  if (!warehouse) {
    warehouse = await Warehouse.create({ tenantId: tenant._id, code: 'WH-MAIN', name: 'Main Store' })
  }

  const partData = [
    { partNumber: 'BRK-PAD-F-001', description: 'Brake Pad Set — Front', category: 'Brakes', brand: 'Bosch', mrp: 2800, gstPercent: 18 },
    { partNumber: 'OIL-FILTER-001', description: 'Engine Oil Filter', category: 'Filters', brand: 'Mann', mrp: 450, gstPercent: 18 },
    { partNumber: 'SPARK-PLUG-004', description: 'Spark Plug Set (4 Nos)', category: 'Engine', brand: 'NGK', mrp: 1200, gstPercent: 18 },
    { partNumber: 'AC-GAS-R134A', description: 'AC Refrigerant R134A', category: 'AC', brand: 'Generic', mrp: 800, gstPercent: 18 },
    { partNumber: 'WIPER-BLADE-18', description: 'Wiper Blade 18 inch', category: 'Accessories', brand: 'Bosch', mrp: 350, gstPercent: 18 },
  ]

  for (const p of partData) {
    let part = await Part.findOne({ tenantId: tenant._id, partNumber: p.partNumber })
    if (!part) {
      part = await Part.create({ tenantId: tenant._id, ...p })
    }
    await StockBalance.updateOne(
      { partId: part._id, warehouseId: warehouse._id },
      {
        $setOnInsert: {
          tenantId: tenant._id,
          partId: part._id,
          warehouseId: warehouse._id,
          onHand: Math.floor(Math.random() * 50) + 5,
          available: Math.floor(Math.random() * 50) + 5,
          reorderLevel: 5,
        },
      },
      { upsert: true },
    )
  }
  console.log(`✓ ${partData.length} parts with stock`)

  const today = new Date()
  const bookingData = [
    { bookingNumber: 'SB-202509-000045', customerId: customers[3]._id, vehicleId: vehicles[3]._id, serviceType: 'Periodic Service', preferredSlot: '10:00 AM', status: 'CONFIRMED' },
    { bookingNumber: 'SB-202509-000046', customerId: customers[2]._id, vehicleId: vehicles[2]._id, serviceType: 'AC Service', preferredSlot: '11:30 AM', status: 'BOOKED' },
    { bookingNumber: 'SB-202509-000047', customerId: customers[4]._id, vehicleId: vehicles[4]._id, serviceType: 'Brake Inspection', preferredSlot: '2:00 PM', status: 'CONFIRMED' },
  ]

  for (const b of bookingData) {
    await Booking.updateOne(
      { tenantId: tenant._id, bookingNumber: b.bookingNumber },
      {
        $setOnInsert: {
          tenantId: tenant._id,
          branchId: branches[0]._id,
          bookingDate: today,
          ...b,
        },
      },
      { upsert: true },
    )
  }
  console.log(`✓ ${bookingData.length} bookings`)

  const stageLogs = SERVICE_STAGES.map((stage, index) => {
    let status: 'NOT_STARTED' | 'CURRENT' | 'COMPLETED' = 'NOT_STARTED'
    if (index < 12) status = 'COMPLETED'
    else if (index === 12) status = 'CURRENT'
    return {
      stage,
      status,
      ...(status === 'COMPLETED' && { completedAt: new Date() }),
      ...(status === 'CURRENT' && { startedAt: new Date() }),
    }
  })

  let visit = await ServiceVisit.findOne({ tenantId: tenant._id, visitNumber: 'SV-202509-000042' })
  if (!visit) {
    visit = await ServiceVisit.create({
      tenantId: tenant._id,
      branchId: branches[0]._id,
      visitNumber: 'SV-202509-000042',
      customerId: customers[0]._id,
      vehicleId: vehicles[0]._id,
      jobCardNumber: 'JC-PAT-202509-000038',
      currentStage: 'WIP',
      status: 'IN_PROGRESS',
      promiseTime: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 18, 0),
      odometer: 45230,
      fuelLevel: 'Petrol — 3/4',
      outstanding: 0,
      stageLogs,
    })
  }

  await JobCard.updateOne(
    { tenantId: tenant._id, jobCardNumber: 'JC-PAT-202509-000038' },
    {
      $setOnInsert: {
        tenantId: tenant._id,
        branchId: branches[0]._id,
        serviceVisitId: visit._id,
        jobCardNumber: 'JC-PAT-202509-000038',
        jobType: 'General Repair',
        bayId: bays[0]._id,
        approvedValue: 8500,
        currentValue: 8500,
        status: 'IN_PROGRESS',
        promiseDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 18, 0),
      },
    },
    { upsert: true },
  )
  console.log('✓ Service visit with workflow stages and job card')

  for (const m of MASTER_SEED) {
    await MasterData.updateOne(
      { tenantId: tenant._id, category: m.category, code: m.code },
      { $setOnInsert: { tenantId: tenant._id, ...m, isActive: true } },
      { upsert: true },
    )
  }
  console.log(`✓ ${MASTER_SEED.length} master data items (dropdowns)`)

  const now = new Date()
  await TaxRule.updateOne(
    { tenantId: tenant._id, ruleName: 'GST 18% Workshop SAC' },
    {
      $set: {
        tenantId: tenant._id,
        ruleName: 'GST 18% Workshop SAC',
        hsnSac: '998729',
        goodsServiceCategory: 'LABOUR',
        gstPercent: 18,
        cgstPercent: 9,
        sgstPercent: 9,
        igstPercent: 18,
        taxInclusive: false,
        effectiveFrom: new Date('2020-01-01'),
        jurisdiction: 'IN',
        active: true,
        approvalStatus: 'APPROVED',
        legalReference: 'Configurable — verify with tax advisor',
      },
    },
    { upsert: true },
  )
  await TaxRule.updateOne(
    { tenantId: tenant._id, ruleName: 'EV 45% REQUESTED NOT APPROVED' },
    {
      $set: {
        tenantId: tenant._id,
        ruleName: 'EV 45% REQUESTED NOT APPROVED',
        hsnSac: '998729-EV',
        gstPercent: 45,
        active: false,
        approvalStatus: 'PENDING',
        effectiveFrom: now,
        remarks: 'Not selectable until legal/tax admin approval',
      },
    },
    { upsert: true },
  )
  await TaxRule.updateOne(
    { tenantId: tenant._id, ruleName: 'GST 18% Parts HSN 8708' },
    {
      $set: {
        tenantId: tenant._id,
        ruleName: 'GST 18% Parts HSN 8708',
        hsnSac: '87089900',
        goodsServiceCategory: 'PARTS',
        gstPercent: 18,
        cgstPercent: 9,
        sgstPercent: 9,
        igstPercent: 18,
        effectiveFrom: new Date('2020-01-01'),
        active: true,
        approvalStatus: 'APPROVED',
      },
    },
    { upsert: true },
  )
  await DiscountPolicy.updateOne(
    { tenantId: tenant._id, code: 'WELCOME10' },
    {
      $set: {
        tenantId: tenant._id,
        code: 'WELCOME10',
        name: 'Welcome 10%',
        discountType: 'PERCENTAGE',
        discountValue: 10,
        maxDiscountCap: 2000,
        active: true,
        beforeTax: true,
        approvalRequired: false,
      },
    },
    { upsert: true },
  )
  console.log('✓ Tax rules and discount policies')

  await PaymentPolicy.updateOne(
    { tenantId: tenant._id, code: 'ADVANCE_OPTIONAL' },
    {
      $set: {
        tenantId: tenant._id,
        code: 'ADVANCE_OPTIONAL',
        name: 'Advance optional',
        allowZeroAdvance: true,
        minimumAdvanceType: 'NONE',
        creditEligibilityRequired: false,
        creditExposureCheck: true,
        active: true,
        effectiveFrom: new Date('2020-01-01'),
      },
    },
    { upsert: true },
  )
  await PaymentPolicy.updateOne(
    { tenantId: tenant._id, code: 'CREDIT_CUSTOMER' },
    {
      $set: {
        tenantId: tenant._id,
        code: 'CREDIT_CUSTOMER',
        name: 'Approved credit customer',
        allowZeroAdvance: true,
        minimumAdvanceType: 'NONE',
        creditEligibilityRequired: true,
        creditExposureCheck: true,
        active: true,
        effectiveFrom: new Date('2020-01-01'),
      },
    },
    { upsert: true },
  )
  console.log('✓ Payment policies (Phase 4)')

  const mainBranch = branches[0]
  await WorkshopTeam.updateOne(
    { tenantId: tenant._id, branchId: mainBranch._id, teamCode: 'MECH-A' },
    {
      $set: {
        tenantId: tenant._id,
        branchId: mainBranch._id,
        teamCode: 'MECH-A',
        name: 'Mechanical Team A',
        specialization: 'MECHANICAL',
        capacity: 6,
        isActive: true,
      },
    },
    { upsert: true },
  )
  await WorkshopTeam.updateOne(
    { tenantId: tenant._id, branchId: mainBranch._id, teamCode: 'ELEC-A' },
    {
      $set: {
        tenantId: tenant._id,
        branchId: mainBranch._id,
        teamCode: 'ELEC-A',
        name: 'Electrical Team A',
        specialization: 'ELECTRICAL',
        capacity: 4,
        isActive: true,
      },
    },
    { upsert: true },
  )
  const branchBays = await Bay.find({ tenantId: tenant._id, branchId: mainBranch._id }).lean()
  for (const bay of branchBays) {
    await WorkshopLocation.updateOne(
      { tenantId: tenant._id, branchId: mainBranch._id, code: bay.code },
      {
        $set: {
          tenantId: tenant._id,
          branchId: mainBranch._id,
          locationType: 'BAY',
          code: bay.code,
          name: bay.name,
          bayId: bay._id,
          exclusiveUse: true,
          capacity: 1,
          isActive: true,
          operationalStatus: 'AVAILABLE',
        },
      },
      { upsert: true },
    )
  }
  await WorkshopLocation.updateOne(
    { tenantId: tenant._id, branchId: mainBranch._id, code: 'OUTDOOR-1' },
    {
      $set: {
        tenantId: tenant._id,
        branchId: mainBranch._id,
        locationType: 'EXTRA_SPACE',
        code: 'OUTDOOR-1',
        name: 'Outdoor work area',
        description: 'General repair extra space',
        allowedWorkTypes: ['MECHANICAL', 'ELECTRICAL'],
        capacity: 2,
        exclusiveUse: false,
        isActive: true,
      },
    },
    { upsert: true },
  )
  console.log('✓ Workshop teams & locations (Phase 5)')

  console.log('\n✅ MongoDB seed completed!\n')
  console.log('Demo Login:')
  console.log('  Tenant Code: DEMO-MOTORS')
  console.log('  Email:       rajesh@demomotors.com')
  console.log('  Password:    demo1234')
  console.log('')
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await disconnectDatabase()
  })
