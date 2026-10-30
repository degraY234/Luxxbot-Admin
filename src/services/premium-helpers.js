import { isPremiumUser } from './premium-users.js';

export async function checkPremiumAccess(number, command = 'fitur premium') {
  const isPremium = await isPremiumUser(number);
  return {
    ok: isPremium,
    message: isPremium ? null : '❌ Maaf, perintah `' + command + '` hanya untuk user premium. Kirimkan nomor WA Anda ke owner untuk daftar.'
  };
}
