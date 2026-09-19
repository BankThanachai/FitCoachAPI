// Failure codes per https://docs.opn.ooo/charges-api — kept to the common
// ones; anything else falls back to a generic message rather than leaking
// Omise's internal wording to the user.
const FAILURE_MESSAGES: Record<string, string> = {
  insufficient_fund: 'บัตรมีวงเงินไม่เพียงพอ',
  stolen_or_lost_card: 'บัตรถูกปฏิเสธ กรุณาติดต่อธนาคารของท่าน',
  invalid_card_number: 'หมายเลขบัตรไม่ถูกต้อง',
  invalid_expiration_date: 'วันหมดอายุของบัตรไม่ถูกต้อง',
  invalid_cvv: 'รหัส CVV ไม่ถูกต้อง',
  failed_processing: 'ไม่สามารถดำเนินการชำระเงินได้ กรุณาลองใหม่อีกครั้ง',
  payment_rejected: 'บัตรถูกปฏิเสธ กรุณาลองใช้บัตรอื่น',
  invalid_account: 'บัญชีไม่ถูกต้อง',
};

export function translateOmiseFailure(code?: string | null): string {
  if (code && FAILURE_MESSAGES[code]) {
    return FAILURE_MESSAGES[code];
  }
  return 'การชำระเงินไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
}
