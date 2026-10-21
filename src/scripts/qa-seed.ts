/**
 * Isolated QA fixtures — tenant QA-WORKSHOP, fictional customers/vehicles, role users.
 * Requires: ALLOW_QA_SEED=true and MONGODB_URI ending with a qa|test|staging|sandbox DB name.
 */
import bcrypt from 'bcryptjs'
import { connectDatabase, disconnectDatabase } from '../lib/mongoose.js'
import { assertQaDatabaseAllowed } from './qa-environment-guard.js'
import { Branch, Customer, Permission, Role, Tenant, User, Vehicle, NumberingSeries } from '../models/index.js'

const QA_PASSWORD = 'QaTest!2026'

async function upsertPermissions() {
  const codes = [
    'dashboard.view', 'bookings.view', 'bookings.create', 'bookings.edit',
    'service_visits.view', 'service_visits.edit', 'inspections.view', 'inspections.edit', 'inspections.review',
    'estimates.view', 'estimates.create', 'approvals.view', 'approvals.record', 'approvals.job_card_authorize',
    'payments.view', 'payments.record', 'payments.verify', 'payments.share',
    'job_cards.view', 'job_cards.create', 'job_cards.assign', 'job_cards.release', 'job_cards.revise',
    'wip.view', 'wip.start', 'wip.update', 'wip.complete', 'wip.verify', 'wip.release_qc', 'wip.raise_additional_work',
    'parts_requisitions.create', 'parts_requisitions.approve', 'inventory.view', 'inventory.issue', 'inventory.return',
    'qc.view', 'qc.assign', 'qc.start', 'qc.edit', 'qc.submit', 'qc.pass', 'qc.fail', 'qc.rework', 'qc.print',
    'billing.view', 'billing.create', 'crm.view', 'crm.edit', 'customers.credit.view', 'customers.credit.edit',
    'masters.view', 'admin.view', 'financial_auth.exception', 'supplementary_estimates.create',
  ]
  for (const code of codes) {
    const [module, ...rest] = code.split('.')
    const action = rest.join('.')
    await Permission.updateOne(
      { code },
      { $setOnInsert: { module, action, code, description: code } },
      { upsert: true },
    )
  }
  return codes
}

async function main() {
  const { databaseName } = assertQaDatabaseAllowed()
  console.log(`QA seed → database: ${databaseName}`)
  await connectDatabase()
  const allPermCodes = await upsertPermissions()
  const passwordHash = await bcrypt.hash(QA_PASSWORD, 12)

  let tenant = await Tenant.findOne({ code: 'QA-WORKSHOP' })
  if (!tenant) {
    tenant = await Tenant.create({
      code: 'QA-WORKSHOP',
      name: 'QA Workshop (Fictional)',
      legalName: 'QA Workshop Testing Pvt Ltd',
      gstin: '10QA0000000Q1Z5',
      email: 'qa-workshop@example.test',
      phone: '+91 90000 00001',
      city: 'Patna',
      state: 'Bihar',
      pin: '800001',
      plan: 'professional',
      status: 'ACTIVE',
    })
  }

  const branchDefs = [
    { code: 'QA-PATNA', name: 'QA Patna Branch', city: 'Patna', state: 'Bihar' },
    { code: 'QA-BRANCH-2', name: 'QA Second Branch', city: 'Gaya', state: 'Bihar' },
  ]
  const branches = []
  for (const b of branchDefs) {
    let branch = await Branch.findOne({ tenantId: tenant._id, code: b.code })
    if (!branch) {
      branch = await Branch.create({ tenantId: tenant._id, ...b, pin: '800001', active: true })
    }
    branches.push(branch)
  }

  for (const s of ['BOOKING', 'SERVICE_VISIT', 'FINAL_INVOICE', 'GATE_PASS', 'RECEIPT']) {
    await NumberingSeries.updateOne(
      { tenantId: tenant._id, module: s },
      { $setOnInsert: { tenantId: tenant._id, module: s, prefix: s.slice(0, 3), currentNo: 1, padLength: 6 } },
      { upsert: true },
    )
  }

  const roleDefs: { code: string; name: string; perms: string[] }[] = [
    { code: 'QA_ADMIN', name: 'QA Admin', perms: allPermCodes },
    {
      code: 'SERVICE_ADVISOR',
      name: 'Service Advisor',
      perms: allPermCodes.filter((p) => !p.startsWith('admin.')),
    },
    { code: 'INSPECTOR', name: 'Inspector', perms: ['dashboard.view', 'service_visits.view', 'inspections.view', 'inspections.edit', 'qc.view', 'qc.start', 'qc.edit', 'qc.submit', 'qc.pass', 'qc.fail'] },
    { code: 'TECHNICIAN', name: 'Technician', perms: ['dashboard.view', 'wip.view', 'wip.update', 'wip.complete', 'parts_requisitions.create', 'inventory.view'] },
    { code: 'CASHIER', name: 'Cashier', perms: ['dashboard.view', 'billing.view', 'billing.create', 'payments.view', 'payments.record', 'payments.verify'] },
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
      await Role.updateOne({ _id: role._id }, { $set: { permissionCodes: rd.perms } })
    }
    roles[rd.code] = role._id.toString()
  }

  const users = [
    { email: 'qa.admin@example.test', firstName: 'QA', lastName: 'Admin', role: 'QA_ADMIN' },
    { email: 'qa.advisor@example.test', firstName: 'QA', lastName: 'Advisor', role: 'SERVICE_ADVISOR' },
    { email: 'qa.inspector@example.test', firstName: 'QA', lastName: 'Inspector', role: 'INSPECTOR' },
    { email: 'qa.mechanic@example.test', firstName: 'QA', lastName: 'Mechanic', role: 'TECHNICIAN' },
    { email: 'qa.cashier@example.test', firstName: 'QA', lastName: 'Cashier', role: 'CASHIER' },
  ]
  for (const u of users) {
    await User.updateOne(
      { tenantId: tenant._id, email: u.email },
      {
        $set: {
          passwordHash,
          firstName: u.firstName,
          lastName: u.lastName,
          roleId: roles[u.role],
          branchIds: branches.map((b) => b._id),
          isActive: true,
          isPlatformAdmin: false,
        },
        $setOnInsert: { tenantId: tenant._id, email: u.email },
      },
      { upsert: true },
    )
  }

  const customers = []
  for (let i = 1; i <= 3; i++) {
    const code = `QA-CUS-${String(i).padStart(3, '0')}`
    let c = await Customer.findOne({ tenantId: tenant._id, code })
    if (!c) {
      c = await Customer.create({
        tenantId: tenant._id,
        code,
        name: `QA Customer ${i}`,
        mobile: `9000000${String(i).padStart(3, '0')}`,
        email: `qa.customer${i}@example.test`,
        type: 'INDIVIDUAL',
        city: 'Patna',
      })
    }
    customers.push(c)
  }

  for (let i = 0; i < customers.length; i++) {
    const reg = `QA ${String(i + 1).padStart(2, '0')} XX ${1000 + i}`
    await Vehicle.updateOne(
      { tenantId: tenant._id, registrationNo: reg },
      {
        $set: {
          customerId: customers[i]._id,
          make: 'QA',
          model: 'TestVehicle',
          fuelType: 'Petrol',
          manufacturingYear: 2022,
          odometer: 10000 + i * 100,
        },
        $setOnInsert: { tenantId: tenant._id, registrationNo: reg },
      },
      { upsert: true },
    )
  }

  console.log('✓ QA-WORKSHOP tenant ready')
  console.log('  Tenant code: QA-WORKSHOP')
  console.log(`  Password (all QA users): ${QA_PASSWORD}`)
  console.log('  Users: qa.admin@example.test, qa.advisor@example.test, qa.inspector@example.test, qa.mechanic@example.test, qa.cashier@example.test')
  await disconnectDatabase()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
