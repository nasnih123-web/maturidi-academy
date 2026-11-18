/**
 * Country calling codes for the registration phone field (Phase A).
 * The site is global: the visitor picks a country (flag + dial code)
 * and the national number is length-checked against that country —
 * nothing is hard-coded to Iran. Whether a country must also verify
 * by SMS is a CRM-controlled server setting (auth.sms_required_countries).
 */

export interface CountryDef {
  iso: string;
  dial: string;
  /** Expected length range of the national (significant) number. */
  min: number;
  max: number;
}

export const COUNTRIES: CountryDef[] = [
  { iso: 'IR', dial: '98', min: 10, max: 10 },
  { iso: 'AF', dial: '93', min: 9, max: 9 },
  { iso: 'IQ', dial: '964', min: 10, max: 10 },
  { iso: 'TR', dial: '90', min: 10, max: 10 },
  { iso: 'AE', dial: '971', min: 9, max: 9 },
  { iso: 'SA', dial: '966', min: 9, max: 9 },
  { iso: 'QA', dial: '974', min: 8, max: 8 },
  { iso: 'KW', dial: '965', min: 8, max: 8 },
  { iso: 'OM', dial: '968', min: 8, max: 8 },
  { iso: 'BH', dial: '973', min: 8, max: 8 },
  { iso: 'PK', dial: '92', min: 10, max: 10 },
  { iso: 'IN', dial: '91', min: 10, max: 10 },
  { iso: 'BD', dial: '880', min: 10, max: 10 },
  { iso: 'TJ', dial: '992', min: 9, max: 9 },
  { iso: 'UZ', dial: '998', min: 9, max: 9 },
  { iso: 'TM', dial: '993', min: 8, max: 8 },
  { iso: 'AZ', dial: '994', min: 9, max: 9 },
  { iso: 'ID', dial: '62', min: 9, max: 12 },
  { iso: 'MY', dial: '60', min: 9, max: 10 },
  { iso: 'EG', dial: '20', min: 10, max: 10 },
  { iso: 'SY', dial: '963', min: 9, max: 9 },
  { iso: 'LB', dial: '961', min: 7, max: 8 },
  { iso: 'JO', dial: '962', min: 9, max: 9 },
  { iso: 'YE', dial: '967', min: 9, max: 9 },
  { iso: 'MA', dial: '212', min: 9, max: 9 },
  { iso: 'DZ', dial: '213', min: 9, max: 9 },
  { iso: 'TN', dial: '216', min: 8, max: 8 },
  { iso: 'NG', dial: '234', min: 10, max: 10 },
  { iso: 'GB', dial: '44', min: 10, max: 10 },
  { iso: 'DE', dial: '49', min: 10, max: 11 },
  { iso: 'FR', dial: '33', min: 9, max: 9 },
  { iso: 'NL', dial: '31', min: 9, max: 9 },
  { iso: 'SE', dial: '46', min: 9, max: 9 },
  { iso: 'RU', dial: '7', min: 10, max: 10 },
  { iso: 'CN', dial: '86', min: 11, max: 11 },
  { iso: 'AU', dial: '61', min: 9, max: 9 },
  { iso: 'CA', dial: '1', min: 10, max: 10 },
  { iso: 'US', dial: '1', min: 10, max: 10 },
  { iso: 'AX', dial: '35818', min: 4, max: 15 },
  { iso: 'AL', dial: '355', min: 4, max: 15 },
  { iso: 'AS', dial: '1684', min: 4, max: 15 },
  { iso: 'AD', dial: '376', min: 4, max: 15 },
  { iso: 'AO', dial: '244', min: 4, max: 15 },
  { iso: 'AI', dial: '1264', min: 4, max: 15 },
  { iso: 'AG', dial: '1268', min: 4, max: 15 },
  { iso: 'AR', dial: '54', min: 4, max: 15 },
  { iso: 'AM', dial: '374', min: 4, max: 15 },
  { iso: 'AW', dial: '297', min: 4, max: 15 },
  { iso: 'AT', dial: '43', min: 4, max: 15 },
  { iso: 'BS', dial: '1242', min: 4, max: 15 },
  { iso: 'BB', dial: '1246', min: 4, max: 15 },
  { iso: 'BY', dial: '375', min: 4, max: 15 },
  { iso: 'BE', dial: '32', min: 4, max: 15 },
  { iso: 'BZ', dial: '501', min: 4, max: 15 },
  { iso: 'BJ', dial: '229', min: 4, max: 15 },
  { iso: 'BM', dial: '1441', min: 4, max: 15 },
  { iso: 'BT', dial: '975', min: 4, max: 15 },
  { iso: 'BO', dial: '591', min: 4, max: 15 },
  { iso: 'BA', dial: '387', min: 4, max: 15 },
  { iso: 'BW', dial: '267', min: 4, max: 15 },
  { iso: 'BV', dial: '47', min: 4, max: 15 },
  { iso: 'BR', dial: '55', min: 4, max: 15 },
  { iso: 'IO', dial: '246', min: 4, max: 15 },
  { iso: 'VG', dial: '1284', min: 4, max: 15 },
  { iso: 'BN', dial: '673', min: 4, max: 15 },
  { iso: 'BG', dial: '359', min: 4, max: 15 },
  { iso: 'BF', dial: '226', min: 4, max: 15 },
  { iso: 'BI', dial: '257', min: 4, max: 15 },
  { iso: 'KH', dial: '855', min: 4, max: 15 },
  { iso: 'CM', dial: '237', min: 4, max: 15 },
  { iso: 'CV', dial: '238', min: 4, max: 15 },
  { iso: 'BQ', dial: '599', min: 4, max: 15 },
  { iso: 'KY', dial: '1345', min: 4, max: 15 },
  { iso: 'CF', dial: '236', min: 4, max: 15 },
  { iso: 'TD', dial: '235', min: 4, max: 15 },
  { iso: 'CL', dial: '56', min: 4, max: 15 },
  { iso: 'CX', dial: '61', min: 4, max: 15 },
  { iso: 'CC', dial: '61', min: 4, max: 15 },
  { iso: 'CO', dial: '57', min: 4, max: 15 },
  { iso: 'KM', dial: '269', min: 4, max: 15 },
  { iso: 'CG', dial: '242', min: 4, max: 15 },
  { iso: 'CK', dial: '682', min: 4, max: 15 },
  { iso: 'CR', dial: '506', min: 4, max: 15 },
  { iso: 'HR', dial: '385', min: 4, max: 15 },
  { iso: 'CU', dial: '53', min: 4, max: 15 },
  { iso: 'CW', dial: '599', min: 4, max: 15 },
  { iso: 'CY', dial: '357', min: 4, max: 15 },
  { iso: 'CZ', dial: '420', min: 4, max: 15 },
  { iso: 'DK', dial: '45', min: 4, max: 15 },
  { iso: 'DJ', dial: '253', min: 4, max: 15 },
  { iso: 'DM', dial: '1767', min: 4, max: 15 },
  { iso: 'DO', dial: '1', min: 4, max: 15 },
  { iso: 'CD', dial: '243', min: 4, max: 15 },
  { iso: 'EC', dial: '593', min: 4, max: 15 },
  { iso: 'SV', dial: '503', min: 4, max: 15 },
  { iso: 'GQ', dial: '240', min: 4, max: 15 },
  { iso: 'ER', dial: '291', min: 4, max: 15 },
  { iso: 'EE', dial: '372', min: 4, max: 15 },
  { iso: 'SZ', dial: '268', min: 4, max: 15 },
  { iso: 'ET', dial: '251', min: 4, max: 15 },
  { iso: 'FK', dial: '500', min: 4, max: 15 },
  { iso: 'FO', dial: '298', min: 4, max: 15 },
  { iso: 'FJ', dial: '679', min: 4, max: 15 },
  { iso: 'FI', dial: '358', min: 4, max: 15 },
  { iso: 'GF', dial: '594', min: 4, max: 15 },
  { iso: 'PF', dial: '689', min: 4, max: 15 },
  { iso: 'TF', dial: '262', min: 4, max: 15 },
  { iso: 'GA', dial: '241', min: 4, max: 15 },
  { iso: 'GM', dial: '220', min: 4, max: 15 },
  { iso: 'GE', dial: '995', min: 4, max: 15 },
  { iso: 'GH', dial: '233', min: 4, max: 15 },
  { iso: 'GI', dial: '350', min: 4, max: 15 },
  { iso: 'GR', dial: '30', min: 4, max: 15 },
  { iso: 'GL', dial: '299', min: 4, max: 15 },
  { iso: 'GD', dial: '1473', min: 4, max: 15 },
  { iso: 'GP', dial: '590', min: 4, max: 15 },
  { iso: 'GU', dial: '1671', min: 4, max: 15 },
  { iso: 'GT', dial: '502', min: 4, max: 15 },
  { iso: 'GG', dial: '44', min: 4, max: 15 },
  { iso: 'GN', dial: '224', min: 4, max: 15 },
  { iso: 'GW', dial: '245', min: 4, max: 15 },
  { iso: 'GY', dial: '592', min: 4, max: 15 },
  { iso: 'HT', dial: '509', min: 4, max: 15 },
  { iso: 'HN', dial: '504', min: 4, max: 15 },
  { iso: 'HK', dial: '852', min: 4, max: 15 },
  { iso: 'HU', dial: '36', min: 4, max: 15 },
  { iso: 'IS', dial: '354', min: 4, max: 15 },
  { iso: 'IE', dial: '353', min: 4, max: 15 },
  { iso: 'IM', dial: '44', min: 4, max: 15 },
  { iso: 'IL', dial: '972', min: 4, max: 15 },
  { iso: 'IT', dial: '39', min: 4, max: 15 },
  { iso: 'CI', dial: '225', min: 4, max: 15 },
  { iso: 'JM', dial: '1876', min: 4, max: 15 },
  { iso: 'JP', dial: '81', min: 4, max: 15 },
  { iso: 'JE', dial: '44', min: 4, max: 15 },
  { iso: 'KZ', dial: '7', min: 4, max: 15 },
  { iso: 'KE', dial: '254', min: 4, max: 15 },
  { iso: 'KI', dial: '686', min: 4, max: 15 },
  { iso: 'XK', dial: '383', min: 4, max: 15 },
  { iso: 'KG', dial: '996', min: 4, max: 15 },
  { iso: 'LA', dial: '856', min: 4, max: 15 },
  { iso: 'LV', dial: '371', min: 4, max: 15 },
  { iso: 'LS', dial: '266', min: 4, max: 15 },
  { iso: 'LR', dial: '231', min: 4, max: 15 },
  { iso: 'LY', dial: '218', min: 4, max: 15 },
  { iso: 'LI', dial: '423', min: 4, max: 15 },
  { iso: 'LT', dial: '370', min: 4, max: 15 },
  { iso: 'LU', dial: '352', min: 4, max: 15 },
  { iso: 'MO', dial: '853', min: 4, max: 15 },
  { iso: 'MG', dial: '261', min: 4, max: 15 },
  { iso: 'MW', dial: '265', min: 4, max: 15 },
  { iso: 'MV', dial: '960', min: 4, max: 15 },
  { iso: 'ML', dial: '223', min: 4, max: 15 },
  { iso: 'MT', dial: '356', min: 4, max: 15 },
  { iso: 'MH', dial: '692', min: 4, max: 15 },
  { iso: 'MQ', dial: '596', min: 4, max: 15 },
  { iso: 'MR', dial: '222', min: 4, max: 15 },
  { iso: 'MU', dial: '230', min: 4, max: 15 },
  { iso: 'YT', dial: '262', min: 4, max: 15 },
  { iso: 'MX', dial: '52', min: 4, max: 15 },
  { iso: 'FM', dial: '691', min: 4, max: 15 },
  { iso: 'MD', dial: '373', min: 4, max: 15 },
  { iso: 'MC', dial: '377', min: 4, max: 15 },
  { iso: 'MN', dial: '976', min: 4, max: 15 },
  { iso: 'ME', dial: '382', min: 4, max: 15 },
  { iso: 'MS', dial: '1664', min: 4, max: 15 },
  { iso: 'MZ', dial: '258', min: 4, max: 15 },
  { iso: 'MM', dial: '95', min: 4, max: 15 },
  { iso: 'NA', dial: '264', min: 4, max: 15 },
  { iso: 'NR', dial: '674', min: 4, max: 15 },
  { iso: 'NP', dial: '977', min: 4, max: 15 },
  { iso: 'NC', dial: '687', min: 4, max: 15 },
  { iso: 'NZ', dial: '64', min: 4, max: 15 },
  { iso: 'NI', dial: '505', min: 4, max: 15 },
  { iso: 'NE', dial: '227', min: 4, max: 15 },
  { iso: 'NU', dial: '683', min: 4, max: 15 },
  { iso: 'NF', dial: '672', min: 4, max: 15 },
  { iso: 'KP', dial: '850', min: 4, max: 15 },
  { iso: 'MK', dial: '389', min: 4, max: 15 },
  { iso: 'MP', dial: '1670', min: 4, max: 15 },
  { iso: 'NO', dial: '47', min: 4, max: 15 },
  { iso: 'PW', dial: '680', min: 4, max: 15 },
  { iso: 'PS', dial: '970', min: 4, max: 15 },
  { iso: 'PA', dial: '507', min: 4, max: 15 },
  { iso: 'PG', dial: '675', min: 4, max: 15 },
  { iso: 'PY', dial: '595', min: 4, max: 15 },
  { iso: 'PE', dial: '51', min: 4, max: 15 },
  { iso: 'PH', dial: '63', min: 4, max: 15 },
  { iso: 'PN', dial: '64', min: 4, max: 15 },
  { iso: 'PL', dial: '48', min: 4, max: 15 },
  { iso: 'PT', dial: '351', min: 4, max: 15 },
  { iso: 'PR', dial: '1', min: 4, max: 15 },
  { iso: 'RE', dial: '262', min: 4, max: 15 },
  { iso: 'RO', dial: '40', min: 4, max: 15 },
  { iso: 'RW', dial: '250', min: 4, max: 15 },
  { iso: 'BL', dial: '590', min: 4, max: 15 },
  { iso: 'SH', dial: '2', min: 4, max: 15 },
  { iso: 'KN', dial: '1869', min: 4, max: 15 },
  { iso: 'LC', dial: '1758', min: 4, max: 15 },
  { iso: 'MF', dial: '590', min: 4, max: 15 },
  { iso: 'PM', dial: '508', min: 4, max: 15 },
  { iso: 'VC', dial: '1784', min: 4, max: 15 },
  { iso: 'WS', dial: '685', min: 4, max: 15 },
  { iso: 'SM', dial: '378', min: 4, max: 15 },
  { iso: 'ST', dial: '239', min: 4, max: 15 },
  { iso: 'SN', dial: '221', min: 4, max: 15 },
  { iso: 'RS', dial: '381', min: 4, max: 15 },
  { iso: 'SC', dial: '248', min: 4, max: 15 },
  { iso: 'SL', dial: '232', min: 4, max: 15 },
  { iso: 'SG', dial: '65', min: 4, max: 15 },
  { iso: 'SX', dial: '1721', min: 4, max: 15 },
  { iso: 'SK', dial: '421', min: 4, max: 15 },
  { iso: 'SI', dial: '386', min: 4, max: 15 },
  { iso: 'SB', dial: '677', min: 4, max: 15 },
  { iso: 'SO', dial: '252', min: 4, max: 15 },
  { iso: 'ZA', dial: '27', min: 4, max: 15 },
  { iso: 'GS', dial: '500', min: 4, max: 15 },
  { iso: 'KR', dial: '82', min: 4, max: 15 },
  { iso: 'SS', dial: '211', min: 4, max: 15 },
  { iso: 'ES', dial: '34', min: 4, max: 15 },
  { iso: 'LK', dial: '94', min: 4, max: 15 },
  { iso: 'SD', dial: '249', min: 4, max: 15 },
  { iso: 'SR', dial: '597', min: 4, max: 15 },
  { iso: 'SJ', dial: '4779', min: 4, max: 15 },
  { iso: 'CH', dial: '41', min: 4, max: 15 },
  { iso: 'TW', dial: '886', min: 4, max: 15 },
  { iso: 'TZ', dial: '255', min: 4, max: 15 },
  { iso: 'TH', dial: '66', min: 4, max: 15 },
  { iso: 'TL', dial: '670', min: 4, max: 15 },
  { iso: 'TG', dial: '228', min: 4, max: 15 },
  { iso: 'TK', dial: '690', min: 4, max: 15 },
  { iso: 'TO', dial: '676', min: 4, max: 15 },
  { iso: 'TT', dial: '1868', min: 4, max: 15 },
  { iso: 'TC', dial: '1649', min: 4, max: 15 },
  { iso: 'TV', dial: '688', min: 4, max: 15 },
  { iso: 'UG', dial: '256', min: 4, max: 15 },
  { iso: 'UA', dial: '380', min: 4, max: 15 },
  { iso: 'UM', dial: '268', min: 4, max: 15 },
  { iso: 'VI', dial: '1340', min: 4, max: 15 },
  { iso: 'UY', dial: '598', min: 4, max: 15 },
  { iso: 'VU', dial: '678', min: 4, max: 15 },
  { iso: 'VA', dial: '3', min: 4, max: 15 },
  { iso: 'VE', dial: '58', min: 4, max: 15 },
  { iso: 'VN', dial: '84', min: 4, max: 15 },
  { iso: 'WF', dial: '681', min: 4, max: 15 },
  { iso: 'EH', dial: '2', min: 4, max: 15 },
  { iso: 'ZM', dial: '260', min: 4, max: 15 },
  { iso: 'ZW', dial: '263', min: 4, max: 15 },
];

export function flagEmoji(iso: string): string {
  return String.fromCodePoint(
    ...[...iso.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Persian/Arabic digits → Latin; everything non-digit dropped. */
export function toLatinDigits(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const fi = FA_DIGITS.indexOf(ch);
    if (fi >= 0) {
      out += String(fi);
      continue;
    }
    const ai = AR_DIGITS.indexOf(ch);
    if (ai >= 0) {
      out += String(ai);
      continue;
    }
    if (ch >= '0' && ch <= '9') out += ch;
  }
  return out;
}

/** National number as typed → significant digits (leading zeros stripped). */
export function normalizeNational(raw: string): string {
  return toLatinDigits(raw).replace(/^0+/, '');
}

/**
 * Free-typed full number (verify-email page phone step) → E.164.
 * Accepts +98…, 0098…, 09… (Iran trunk), 98…; returns null when unsure.
 */
export function toE164(raw: string): string | null {
  const trimmed = raw.trim();
  const digits = toLatinDigits(trimmed);
  if (trimmed.startsWith('+') && digits.length >= 7) return `+${digits}`;
  if (digits.startsWith('00') && digits.length >= 9) return `+${digits.slice(2)}`;
  if (digits.startsWith('0') && digits.length === 11) return `+98${digits.slice(1)}`;
  if (digits.startsWith('98') && digits.length === 12) return `+${digits}`;
  return null;
}
