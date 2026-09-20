import { PrismaClient, ServiceStage } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const ALL_STAGES: ServiceStage[] = [
  'BOOKING', 'PICKUP', 'ARRIVAL', 'INVENTORY', 'VOC', 'INSPECTION',
  'DIAGNOSIS', 'ESTIMATE', 'APPROVAL', 'JOB_CARD', 'ASSIGNMENT', 'BAY',
  'WIP', 'QC', 'ROAD_TEST', 'INVOICE', 'PAYMENT', 'GATEPASS',
  'DELIVERY', 'FEEDBACK', 'PSF',
]

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
]

async function main() {
  console.log('🌱 Seeding ZentroSure database...\n')

  // Permissions
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: {},
      create: p,
    })
  }
  const allPermissions = await prisma.permission.findMany()
  console.log(`✓ ${allPermissions.length} permissions`)

  // Platform Super Admin role
  let superAdminRole = await prisma.role.findFirst({
    where: { code: 'SUPER_ADMIN', tenantId: null },
  })
  if (!superAdminRole) {
    superAdminRole = await prisma.role.create({
      data: {
        name: 'ZentroSure Super Admin',
        code: 'SUPER_ADMIN',
        description: 'Platform-level super administrator',
        isSystem: true,
      },
    })
  }

  const passwordHash = await bcrypt.hash('demo1234', 12)

  // Demo Tenant
  const tenant = await prisma.tenant.upsert({
    where: { code: 'DEMO-MOTORS' },
    update: {},
    create: {
      code: 'DEMO-MOTORS',
      name: 'ZentroSure Demo Motors Pvt. Ltd.',
      legalName: 'ZentroSure Demo Motors Private Limited',
      gstin: '10AABCD1234E1Z5',
      email: 'info@demomotors.com',
      phone: '+91 612 234 5678',
      address: 'Fraser Road',
      city: 'Patna',
      state: 'Bihar',
      pin: '800001',
      plan: 'professional',
      status: 'ACTIVE',
    },
  })
  console.log(`✓ Tenant: ${tenant.name}`)

  // Branches
  const branches = await Promise.all([
    prisma.branch.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: 'PAT-01' } },
      update: {},
      create: { tenantId: tenant.id, code: 'PAT-01', name: 'Patna Central Workshop', city: 'Patna', state: 'Bihar' },
    }),
    prisma.branch.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: 'MUZ-01' } },
      update: {},
      create: { tenantId: tenant.id, code: 'MUZ-01', name: 'Muzaffarpur Workshop', city: 'Muzaffarpur', state: 'Bihar' },
    }),
    prisma.branch.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: 'RAN-01' } },
      update: {},
      create: { tenantId: tenant.id, code: 'RAN-01', name: 'Ranchi Workshop', city: 'Ranchi', state: 'Jharkhand' },
    }),
  ])
  console.log(`✓ ${branches.length} branches`)

  // Numbering Series
  const seriesModules = [
    { module: 'BOOKING', prefix: 'SB' },
    { module: 'SERVICE_VISIT', prefix: 'SV' },
    { module: 'CUSTOMER', prefix: 'CUS' },
    { module: 'JOB_CARD', prefix: 'JC', suffix: '' },
  ]
  for (const s of seriesModules) {
    await prisma.numberingSeries.upsert({
      where: { tenantId_module: { tenantId: tenant.id, module: s.module } },
      update: {},
      create: { tenantId: tenant.id, module: s.module, prefix: s.prefix, currentNo: 40, padLength: 6 },
    })
  }

  // Roles
  const roleDefs = [
    { code: 'OWNER', name: 'Owner', perms: allPermissions.map((p) => p.code) },
    { code: 'WORKSHOP_MANAGER', name: 'Workshop Manager', perms: allPermissions.map((p) => p.code) },
    { code: 'SERVICE_ADVISOR', name: 'Service Advisor', perms: ['dashboard.view', 'bookings.view', 'bookings.create', 'bookings.edit', 'service_visits.view', 'service_visits.edit', 'estimates.view', 'estimates.create', 'job_cards.view', 'crm.view', 'crm.edit'] },
    { code: 'TECHNICIAN', name: 'Technician', perms: ['dashboard.view', 'service_visits.view', 'job_cards.view', 'job_cards.edit', 'inventory.view'] },
    { code: 'PARTS_MANAGER', name: 'Parts Manager', perms: ['dashboard.view', 'inventory.view', 'inventory.issue', 'reports.view'] },
    { code: 'CASHIER', name: 'Cashier', perms: ['dashboard.view', 'billing.view', 'billing.create'] },
    { code: 'CRM_EXECUTIVE', name: 'CRM Executive', perms: ['dashboard.view', 'crm.view', 'crm.edit', 'bookings.view'] },
  ]

  const roles: Record<string, string> = {}
  for (const rd of roleDefs) {
    const role = await prisma.role.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: rd.code } },
      update: {},
      create: { tenantId: tenant.id, name: rd.name, code: rd.code, isSystem: true },
    })
    roles[rd.code] = role.id

    for (const permCode of rd.perms) {
      const perm = allPermissions.find((p) => p.code === permCode)
      if (perm) {
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
          update: {},
          create: { roleId: role.id, permissionId: perm.id },
        })
      }
    }
  }
  console.log(`✓ ${roleDefs.length} roles with permissions`)

  // Demo Users
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
    const user = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: u.isPlatformAdmin ? tenant.id : tenant.id, email: u.email } },
      update: { passwordHash },
      create: {
        tenantId: tenant.id,
        email: u.email,
        passwordHash,
        firstName: u.firstName,
        lastName: u.lastName,
        roleId: u.role ? roles[u.role] : superAdminRole.id,
        isPlatformAdmin: u.isPlatformAdmin ?? false,
      },
    })

    if (!u.isPlatformAdmin) {
      for (const branch of branches) {
        await prisma.userBranch.upsert({
          where: { userId_branchId: { userId: user.id, branchId: branch.id } },
          update: {},
          create: { userId: user.id, branchId: branch.id },
        })
      }
    }
  }
  console.log(`✓ ${userDefs.length} demo users (password: demo1234)`)

  // Customers
  const customerData = [
    { code: 'CUS-00001', name: 'Amit Sharma', mobile: '9876543210', email: 'amit@email.com', type: 'INDIVIDUAL' as const, city: 'Patna' },
    { code: 'CUS-00002', name: 'Fleet Solutions Pvt Ltd', mobile: '9123456789', email: 'fleet@company.com', type: 'FLEET' as const, city: 'Patna' },
    { code: 'CUS-00003', name: 'Neha Gupta', mobile: '9988776655', email: 'neha@email.com', type: 'INDIVIDUAL' as const, city: 'Muzaffarpur' },
    { code: 'CUS-00004', name: 'Vikram Patel', mobile: '9876512345', email: 'vikram@email.com', type: 'INDIVIDUAL' as const, city: 'Patna' },
    { code: 'CUS-00005', name: 'Sanjay Mishra', mobile: '8765432109', type: 'INDIVIDUAL' as const, city: 'Ranchi' },
  ]

  const customers = []
  for (const c of customerData) {
    const customer = await prisma.customer.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: c.code } },
      update: {},
      create: { tenantId: tenant.id, ...c },
    })
    customers.push(customer)
  }
  console.log(`✓ ${customers.length} customers`)

  // Vehicles
  const vehicleData = [
    { customerId: customers[0].id, registrationNo: 'BR 01 AB 4521', make: 'Honda', model: 'City', variant: 'VX CVT', fuelType: 'Petrol', manufacturingYear: 2021, odometer: 45230, vin: 'MAHFR2WK5K1234567', engineNo: 'L15Z1-7890123' },
    { customerId: customers[0].id, registrationNo: 'BR 02 CD 7890', make: 'Hyundai', model: 'Creta', variant: 'SX', fuelType: 'Diesel', manufacturingYear: 2022, odometer: 32100 },
    { customerId: customers[2].id, registrationNo: 'BR 06 KL 3456', make: 'Maruti', model: 'Swift', variant: 'VDI', fuelType: 'Diesel', manufacturingYear: 2020, odometer: 67800 },
    { customerId: customers[3].id, registrationNo: 'BR 05 IJ 9012', make: 'Toyota', model: 'Innova Crysta', variant: '2.4 ZX', fuelType: 'Diesel', manufacturingYear: 2019, odometer: 89500 },
    { customerId: customers[4].id, registrationNo: 'BR 07 MN 7890', make: 'Tata', model: 'Nexon', variant: 'XZ+', fuelType: 'Electric', manufacturingYear: 2023, odometer: 12400 },
  ]

  const vehicles = []
  for (const v of vehicleData) {
    const vehicle = await prisma.vehicle.upsert({
      where: { tenantId_registrationNo: { tenantId: tenant.id, registrationNo: v.registrationNo } },
      update: {},
      create: { tenantId: tenant.id, ...v },
    })
    vehicles.push(vehicle)
  }
  console.log(`✓ ${vehicles.length} vehicles`)

  // Bays
  const bayTypes = ['General Repair', 'Quick Service', 'Electrical', 'AC', 'Washing', 'Diagnostic']
  const bays = []
  for (let i = 0; i < bayTypes.length; i++) {
    const bay = await prisma.bay.upsert({
      where: { tenantId_branchId_code: { tenantId: tenant.id, branchId: branches[0].id, code: `BAY-${i + 1}` } },
      update: {},
      create: { tenantId: tenant.id, branchId: branches[0].id, code: `BAY-${i + 1}`, name: `Bay ${i + 1}`, bayType: bayTypes[i] },
    })
    bays.push(bay)
  }
  console.log(`✓ ${bays.length} bays`)

  // Parts & Inventory
  const warehouse = await prisma.warehouse.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'WH-MAIN' } },
    update: {},
    create: { tenantId: tenant.id, code: 'WH-MAIN', name: 'Main Store' },
  })

  const partData = [
    { partNumber: 'BRK-PAD-F-001', description: 'Brake Pad Set — Front', category: 'Brakes', brand: 'Bosch', mrp: 2800, gstPercent: 18 },
    { partNumber: 'OIL-FILTER-001', description: 'Engine Oil Filter', category: 'Filters', brand: 'Mann', mrp: 450, gstPercent: 18 },
    { partNumber: 'SPARK-PLUG-004', description: 'Spark Plug Set (4 Nos)', category: 'Engine', brand: 'NGK', mrp: 1200, gstPercent: 18 },
    { partNumber: 'AC-GAS-R134A', description: 'AC Refrigerant R134A', category: 'AC', brand: 'Generic', mrp: 800, gstPercent: 18 },
    { partNumber: 'WIPER-BLADE-18', description: 'Wiper Blade 18 inch', category: 'Accessories', brand: 'Bosch', mrp: 350, gstPercent: 18 },
  ]

  for (const p of partData) {
    const part = await prisma.part.upsert({
      where: { tenantId_partNumber: { tenantId: tenant.id, partNumber: p.partNumber } },
      update: {},
      create: { tenantId: tenant.id, ...p },
    })
    await prisma.stockBalance.upsert({
      where: { partId_warehouseId: { partId: part.id, warehouseId: warehouse.id } },
      update: {},
      create: { tenantId: tenant.id, partId: part.id, warehouseId: warehouse.id, available: Math.floor(Math.random() * 50) + 5, reorderLevel: 5 },
    })
  }
  console.log(`✓ ${partData.length} parts with stock`)

  // Bookings
  const today = new Date()
  const bookingData = [
    { bookingNumber: 'SB-202509-000045', customerId: customers[3].id, vehicleId: vehicles[3].id, serviceType: 'Periodic Service', preferredSlot: '10:00 AM', status: 'CONFIRMED' as const },
    { bookingNumber: 'SB-202509-000046', customerId: customers[2].id, vehicleId: vehicles[2].id, serviceType: 'AC Service', preferredSlot: '11:30 AM', status: 'BOOKED' as const },
    { bookingNumber: 'SB-202509-000047', customerId: customers[4].id, vehicleId: vehicles[4].id, serviceType: 'Brake Inspection', preferredSlot: '2:00 PM', status: 'CONFIRMED' as const },
  ]

  for (const b of bookingData) {
    await prisma.booking.upsert({
      where: { tenantId_bookingNumber: { tenantId: tenant.id, bookingNumber: b.bookingNumber } },
      update: {},
      create: {
        tenantId: tenant.id,
        branchId: branches[0].id,
        bookingDate: today,
        ...b,
      },
    })
  }
  console.log(`✓ ${bookingData.length} bookings`)

  // Service Visit with full workflow
  const visit = await prisma.serviceVisit.upsert({
    where: { tenantId_visitNumber: { tenantId: tenant.id, visitNumber: 'SV-202509-000042' } },
    update: {},
    create: {
      tenantId: tenant.id,
      branchId: branches[0].id,
      visitNumber: 'SV-202509-000042',
      customerId: customers[0].id,
      vehicleId: vehicles[0].id,
      jobCardNumber: 'JC-PAT-202509-000038',
      currentStage: 'WIP',
      status: 'IN_PROGRESS',
      promiseTime: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 18, 0),
      odometer: 45230,
      fuelLevel: 'Petrol — 3/4',
      outstanding: 0,
    },
  })

  for (const stage of ALL_STAGES) {
    const stageIndex = ALL_STAGES.indexOf(stage)
    let status: 'NOT_STARTED' | 'CURRENT' | 'COMPLETED' = 'NOT_STARTED'
    if (stageIndex < 12) status = 'COMPLETED'
    else if (stageIndex === 12) status = 'CURRENT'

    await prisma.serviceStageLog.upsert({
      where: { serviceVisitId_stage: { serviceVisitId: visit.id, stage } },
      update: { status },
      create: {
        serviceVisitId: visit.id,
        stage,
        status,
        ...(status === 'COMPLETED' && { completedAt: new Date() }),
        ...(status === 'CURRENT' && { startedAt: new Date() }),
      },
    })
  }

  await prisma.jobCard.upsert({
    where: { tenantId_jobCardNumber: { tenantId: tenant.id, jobCardNumber: 'JC-PAT-202509-000038' } },
    update: {},
    create: {
      tenantId: tenant.id,
      branchId: branches[0].id,
      serviceVisitId: visit.id,
      jobCardNumber: 'JC-PAT-202509-000038',
      jobType: 'General Repair',
      bayId: bays[0].id,
      approvedValue: 8500,
      currentValue: 8500,
      status: 'IN_PROGRESS',
      promiseDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 18, 0),
    },
  })
  console.log('✓ Service visit with workflow stages and job card')

  console.log('\n✅ Seed completed!\n')
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
    await prisma.$disconnect()
  })
