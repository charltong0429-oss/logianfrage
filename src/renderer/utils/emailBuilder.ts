import { FormData, EmailContent } from './types'

const SHIP_FROM_BATT = 'Ankerkade 18, 5928 PL Venlo, the Netherlands'
const SHIP_FROM_STD  = 'Celsiusweg 66, 5928 PR Venlo, the Netherlands'

function extractZipFrom(shipFrom: string): string {
  const words = shipFrom.replace(/,/g, '').split(/\s+/)
  return words[2] ?? ''
}

function extractZipTo(address2: string): string {
  return address2.trim().split(/\s+/)[0] ?? ''
}

/**
 * 欧洲国家名称 → ISO 3166-1 alpha-2 代码。
 */
const COUNTRY_CODE_MAP: Record<string, string> = {
  al: 'AL', ad: 'AD', at: 'AT', by: 'BY', be: 'BE', ba: 'BA', bg: 'BG',
  hr: 'HR', cy: 'CY', cz: 'CZ', dk: 'DK', ee: 'EE', fi: 'FI', fr: 'FR',
  de: 'DE', gr: 'GR', hu: 'HU', is: 'IS', ie: 'IE', it: 'IT', xk: 'XK',
  lv: 'LV', li: 'LI', lt: 'LT', lu: 'LU', mt: 'MT', md: 'MD', mc: 'MC',
  me: 'ME', nl: 'NL', mk: 'MK', no: 'NO', pl: 'PL', pt: 'PT', ro: 'RO',
  ru: 'RU', sm: 'SM', rs: 'RS', sk: 'SK', si: 'SI', es: 'ES', se: 'SE',
  ch: 'CH', ua: 'UA', gb: 'GB', va: 'VA',
  albania: 'AL', albanien: 'AL', albanie: 'AL',
  andorra: 'AD',
  austria: 'AT', österreich: 'AT', osterreich: 'AT', autriche: 'AT',
  belarus: 'BY', weißrussland: 'BY', weissrussland: 'BY',
  belgium: 'BE', belgien: 'BE', belgique: 'BE', belgië: 'BE', belgie: 'BE',
  'bosnia and herzegovina': 'BA', 'bosnia & herzegovina': 'BA', bosnien: 'BA',
  bulgaria: 'BG', bulgarien: 'BG', bulgarie: 'BG',
  croatia: 'HR', kroatien: 'HR', croatie: 'HR', hrvatska: 'HR',
  cyprus: 'CY', zypern: 'CY', chypre: 'CY',
  'czech republic': 'CZ', czechia: 'CZ', tschechien: 'CZ', ceska: 'CZ',
  denmark: 'DK', dänemark: 'DK', danemark: 'DK', danmark: 'DK',
  estonia: 'EE', estland: 'EE', estonie: 'EE', eesti: 'EE',
  finland: 'FI', finnland: 'FI', finlande: 'FI', suomi: 'FI',
  france: 'FR', frankreich: 'FR', francia: 'FR',
  germany: 'DE', deutschland: 'DE', allemagne: 'DE',
  greece: 'GR', griechenland: 'GR', hellas: 'GR',
  hungary: 'HU', ungarn: 'HU', hongrie: 'HU', magyarország: 'HU',
  iceland: 'IS', island: 'IS', islande: 'IS',
  ireland: 'IE', irland: 'IE', irlande: 'IE',
  italy: 'IT', italien: 'IT', italie: 'IT', italia: 'IT',
  kosovo: 'XK', kosova: 'XK',
  latvia: 'LV', lettland: 'LV', lettonie: 'LV', latvija: 'LV',
  liechtenstein: 'LI',
  lithuania: 'LT', litauen: 'LT', lituanie: 'LT', lietuva: 'LT',
  luxembourg: 'LU', luxemburg: 'LU',
  malta: 'MT',
  moldova: 'MD', moldawien: 'MD', moldavie: 'MD',
  monaco: 'MC',
  montenegro: 'ME',
  netherlands: 'NL', 'the netherlands': 'NL', niederlande: 'NL', nederland: 'NL',
  'north macedonia': 'MK', nordmazedonien: 'MK',
  norway: 'NO', norwegen: 'NO', norvège: 'NO', norge: 'NO',
  poland: 'PL', polen: 'PL', pologne: 'PL', polska: 'PL',
  portugal: 'PT',
  romania: 'RO', rumänien: 'RO', roumanie: 'RO', românia: 'RO',
  russia: 'RU', russland: 'RU', russie: 'RU',
  'san marino': 'SM',
  serbia: 'RS', serbien: 'RS', serbie: 'RS', srbija: 'RS',
  slovakia: 'SK', slowakei: 'SK', slovaquie: 'SK', slovensko: 'SK',
  slovenia: 'SI', slowenien: 'SI', slovénie: 'SI', slovenija: 'SI',
  spain: 'ES', spanien: 'ES', espagne: 'ES', españa: 'ES', espana: 'ES',
  sweden: 'SE', schweden: 'SE', suède: 'SE', sverige: 'SE',
  switzerland: 'CH', schweiz: 'CH', suisse: 'CH', svizzera: 'CH',
  ukraine: 'UA', ukraina: 'UA',
  'united kingdom': 'GB', uk: 'GB', 'great britain': 'GB', england: 'GB',
  turkey: 'TR', türkei: 'TR', turkei: 'TR', turquie: 'TR', türkiye: 'TR', tr: 'TR',
  armenia: 'AM', am: 'AM',
}

function getCountryCode(countryName: string): string {
  const key = countryName.toLowerCase().trim()
  if (!key) return ''
  return COUNTRY_CODE_MAP[key] ?? ''
}

export const INQUIRY_RECIPIENT = 'cs.frankfurt@dachser.com'

export function buildEmail(data: FormData): EmailContent {
  const shipFrom = data.cargoType === 'BATT' ? SHIP_FROM_BATT : SHIP_FROM_STD

  const zipFrom = extractZipFrom(shipFrom)
  const zipTo = extractZipTo(data.address2)
  const countryCode = getCountryCode(data.address3)

  const destCode = countryCode && zipTo ? `${countryCode}-${zipTo}` : '(Zielort?)'
  const palletsNum = data.pallets.trim().match(/^(\d+)/)?.[1] ?? data.pallets.trim()
  const weightNum = data.weight.trim().match(/([\d.]+)/)?.[1] ?? data.weight.trim()
  const subject = `Anfrage Transport - ${palletsNum} Pallets ${data.cargoType} ${weightNum} kg ab NL ${zipFrom} nach ${destCode} - Unsere Kunden# 47035335`

  const batteryNote = data.cargoType === 'BATT' ? ' of Battery' : ''

  const insuranceText = data.hasInsurance && data.insuranceAmount
    ? `inkl. Transportversicherung Warenwert ${data.insuranceAmount} euro.`
    : ''

  const dgLines: string[] = data.cargoType === 'BATT'
    ? [
        '',
        'Die Sendung beinhaltet Gefahrgut.',
        `GG-Gewicht  ${data.weight}`,
        'UN3480',
        'Verpackungsklasse 9 2E',
      ]
    : []

  // 值为空时整行省略
  function opt(label: string, value: string): string | null {
    return value.trim() ? `${label} * ${value}` : null
  }

  const rawLines: Array<string | null> = [
    'Guten Tag Team Dachser,',
    '',
    `bitte senden Sie uns ein Angebot für den Transport von ${palletsNum} Palleten wie folgt:`,
    '',
    `Loading Address * ${shipFrom}`,
    `Pallets count * ${palletsNum}${batteryNote}`,
    opt('Pallet size-L*W*H', data.dimensions),
    data.loadingMeters.trim() ? `Loading meters   ${data.loadingMeters}` : null,
    `Total Weight--kg * ${data.weight}`,
    '',
    opt('Address', data.address1),
    opt('Post code/City', data.address2),
    `Country * ${data.address3}`,
    '',
    'inkl. automatischer Zustellankündigung,',
  ]

  const bodyLines: string[] = rawLines.filter((l): l is string => l !== null)

  if (insuranceText) bodyLines.push(insuranceText)
  for (const dgLine of dgLines) bodyLines.push(dgLine)

  return { subject, body: bodyLines.join('\r\n') }
}
