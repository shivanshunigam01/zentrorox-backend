export const MASTER_CATEGORIES = {
  SERVICE_TYPE: {
    label: 'Service Types',
    description: 'Periodic service, AC, brakes — used in bookings & job cards',
  },
  VEHICLE_MAKE: {
    label: 'Vehicle Makes',
    description: 'Honda, Hyundai, Maruti — used in vehicle master',
  },
  VEHICLE_MODEL: {
    label: 'Vehicle Models',
    description: 'City, Creta, Swift — linked to make via parent code',
  },
  FUEL_TYPE: {
    label: 'Fuel Types',
    description: 'Petrol, Diesel, CNG, Electric',
  },
  BAY_TYPE: {
    label: 'Bay Types',
    description: 'General repair, quick service, AC bay',
  },
  JOB_TYPE: {
    label: 'Job Types',
    description: 'General repair, warranty, accident',
  },
  BOOKING_SOURCE: {
    label: 'Booking Sources',
    description: 'Walk-in, phone, website, WhatsApp',
  },
  PAYMENT_MODE: {
    label: 'Payment Modes',
    description: 'Cash, UPI, card, credit',
  },
  COMPLAINT_TYPE: {
    label: 'Complaint Types',
    description: 'Engine, brakes, AC, electrical',
  },
} as const

export type MasterCategory = keyof typeof MASTER_CATEGORIES

export const MASTER_CATEGORY_KEYS = Object.keys(MASTER_CATEGORIES) as MasterCategory[]
