import { useMemo } from 'react'
import { FormData, EmailContent } from '../utils/types'
import { buildEmail } from '../utils/emailBuilder'

export function useEmailTemplate(data: FormData): EmailContent {
  return useMemo(() => buildEmail(data), [
    data.pallets,
    data.dimensions,
    data.loadingMeters,
    data.weight,
    data.address1,
    data.address2,
    data.address3,
    data.cargoType,
    data.hasInsurance,
    data.insuranceAmount
  ])
}
