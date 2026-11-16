import {
  db,
  signToken,
  verifyToken,
  hashPassword,
  verifyPassword,
  formatWibCompare,
  formatWibReadable,
  parseWibInputToIso,
  ensureInitialSeed
} from './_firebase.js';

function requireAdmin(sessionToken, requireSuperAdmin = false) {
  const payload = verifyToken(sessionToken);
  if (!payload || payload.type !== 'admin') {
    return { ok: false, response: { success: false, authError: true, message: 'Sesi berakhir. Silakan login ulang.' } };
  }
  if (requireSuperAdmin && payload.role !== 'Super Admin') {
    return { ok: false, response: { success: false, message: 'Akses ditolak! Fitur ini khusus Super Admin.' } };
  }
  return { ok: true, session: payload };
}

function verifyStudentSession(nisn, studentToken) {
  const payload = verifyToken(studentToken);
  return Boolean(payload && payload.type === 'student' && payload.nisn === String(nisn).trim());
}

const handlers = {
  async getLogoAndTitles() {
    const doc = await db.collection('settings').doc('app').get();
    const defaultLogo = 'https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEhD7mKvCj7XMXoZ3EGkFZ37RhLV42t8f6JOJRx8NZo5ehsSV0sM7eoErGMorImGx194-IuxEj6HHIVf-NsLeZaXdzumArgilOAr3AF6VpaQhCytLdDatqSz_mJ5W0MYvlih7ODJWklWHGkClRIsVr0fiwpbF4AEaxR2mEUWajlCrOCwv4WgLnNCRhhzqJg/w1200-h630-p-k-no-nu/logo%20smk%20kordova.png';
    return { logoUrl: (doc.exists && doc.data().logoUrl) || defaultLogo };
  },

  async getLevels() {
    const snap = await db.collection('students').get();
    const set = new Set();
    snap.forEach(doc => {
      const t = String(doc.data().tingkat || '').trim();
      if (t) set.add(t);
    });
    return Array.from(set).sort();
  },

  async getClassesForLevel(level) {
    const cleanLevel = String(level || '').trim();
    const snap = await db.collection('students').where('tingkat', '==', cleanLevel).get();
    const set = new Set();
    snap.forEach(doc => {
      const k = String(doc.data().kelas || '').trim();
      if (k) set.add(k);
    });
    return Array.from(set).sort();
  },

  async getSubjectsForLevel(level) {
    const cleanLevel = String(level || '').trim();
    const snap = await db.collection('soal').where('tingkat', '==', cleanLevel).get();
    const nowStr = formatWibCompare(new Date());
    const set = new Set();
    snap.forEach(doc => {
      const d = doc.data();
      if (!d.mata) return;
      const mulaiStr = formatWibCompare(d.mulai);
      const selesaiStr = formatWibCompare(d.selesai);
      const inWindow = (!mulaiStr || nowStr >= mulaiStr) && (!selesaiStr || nowStr <= selesaiStr);
      if (inWindow) set.add(String(d.mata).trim());
    });
    return Array.from(set).sort();
  },

  async authenticateStudent(nisn, tingkat, kelas, mapel) {
    const cleanNisn = String(nisn || '').trim();
    const cleanTingkat = String(tingkat || '').trim();
    const cleanKelas = String(kelas || '').trim();
    const cleanMapel = String(mapel || '').trim();

    const snap = await db.collection('students')
      .where('nisn', '==', cleanNisn)
      .where('tingkat', '==', cleanTingkat)
      .where('kelas', '==', cleanKelas)
      .limit(1)
      .get();

    if (snap.empty) {
      return { success: false, message: 'Data NISN, Tingkat, dan Kelas tidak cocok!' };
    }

    const d = snap.docs[0].data();
    const status = String(d.status || 'Belum').trim();
    const st = status.toLowerCase();

    if (st === 'selesai') {
      return { success: false, message: 'Anda sudah menyelesaikan ujian ini (Batas Ujian 1x).' };
    }
    if (st.includes('mengerjakan')) {
      return { success: false, message: 'Akun Anda sedang berstatus MENGERJAKAN. Hubungi Pengawas jika perangkat terputus/restart.' };
    }
    if (st.includes('kunci') || st.includes('pelanggaran') || st.includes('curiga') || st.includes('tidak aktif')) {
      return { success: false, message: 'AKUN DIKUNCI! Terdeteksi pelanggaran. Lapor ke Pengawas untuk membuka akses.' };
    }

    return {
      success: true,
      data: {
        nisn: cleanNisn,
        nama: String(d.nama || '').trim(),
        tingkat: cleanTingkat,
        kelas: cleanKelas,
        mataPelajaran: cleanMapel,
        status,
        foto: String(d.foto || '').trim(),
        ruang: String(d.ruang || '').trim(),
        studentToken: signToken({ type: 'student', nisn: cleanNisn })
      }
    };
  },

  async validateToken(tingkat, mapel, tokenInput) {
    const cleanTingkat = String(tingkat || '').trim();
    const cleanMapel = String(mapel || '').trim();
    const cleanToken = String(tokenInput || '').trim();

    const snap = await db.collection('soal')
      .where('tingkat', '==', cleanTingkat)
      .where('mata', '==', cleanMapel)
      .get();

    if (snap.empty) return { success: false, message: 'Soal tidak ditemukan.' };

    const nowStr = formatWibCompare(new Date());
    const candidates = snap.docs.map(doc => doc.data());

    const soalFound = candidates.find(c => {
      const mStr = formatWibCompare(c.mulai);
      const sStr = formatWibCompare(c.selesai);
      const inWindow = (!mStr || nowStr >= mStr) && (!sStr || nowStr <= sStr);
      return String(c.token || '').trim() === cleanToken && inWindow;
    }) || candidates.find(c => String(c.token || '').trim() === cleanToken) || candidates[0];

    if (String(soalFound.token || '').trim() !== cleanToken) {
      return { success: false, message: 'Token salah.' };
    }

    const mulaiStr = formatWibCompare(soalFound.mulai);
    if (mulaiStr && nowStr < mulaiStr) {
      return { success: false, message: `Ujian belum dimulai!\nJadwal Anda: ${formatWibReadable(soalFound.mulai)} WIB` };
    }

    const selesaiStr = formatWibCompare(soalFound.selesai);
    if (selesaiStr && nowStr > selesaiStr) {
      return { success: false, message: `Ujian sudah ditutup sejak:\n${formatWibReadable(soalFound.selesai)} WIB` };
    }

    return {
      success: true,
      link: String(soalFound.link || '').trim(),
      durationMinutes: Number(soalFound.waktu) || 60
    };
  },

  async updateStudentStatus(nisn, statusBaru, studentToken) {
    const allowed = ['Mengerjakan', 'Selesai', 'Dikunci (Pelanggaran)'];
    if (!allowed.includes(statusBaru)) return false;
    if (!verifyStudentSession(nisn, studentToken)) return false;

    const snap = await db.collection('students')
      .where('nisn', '==', String(nisn).trim())
      .limit(1)
      .get();
    if (snap.empty) return false;

    await snap.docs[0].ref.update({ status: statusBaru });
    return true;
  },

  async authenticateAdmin(user, pass) {
    const cleanUser = String(user || '').trim();
    const rawPass = String(pass || '');

    const snap = await db.collection('pengawas')
      .where('user', '==', cleanUser)
      .limit(1)
      .get();

    if (snap.empty) {
      return { success: false, message: 'Username atau Password admin salah.' };
    }

    const acc = snap.docs[0].data();
    if (!verifyPassword(rawPass, acc.pass)) {
      return { success: false, message: 'Username atau Password admin salah.' };
    }

    const name = String(acc.nama || 'Admin').trim();
    const role = String(acc.role || 'Pengawas').trim();
    return {
      success: true,
      name,
      role,
      sessionToken: signToken({ type: 'admin', user: cleanUser, name, role })
    };
  },

  async getLiveDashboardData(sessionToken) {
    const auth = requireAdmin(sessionToken, false);
    if (!auth.ok) return auth.response;

    const snap = await db.collection('students').get();
    let total = 0, aktif = 0, tidakAktif = 0;
    const students = [];

    snap.forEach(doc => {
      const d = doc.data();
      const statusStr = String(d.status || 'Belum').trim();
      total++;
      const st = statusStr.toLowerCase();
      if (st === 'aktif' || st.includes('mengerjakan')) aktif++;
      else tidakAktif++;

      students.push({
        actualRow: doc.id,
        no: d.no || 0,
        nisn: String(d.nisn || '').trim(),
        nama: String(d.nama || '').trim(),
        tingkat: String(d.tingkat || '').trim(),
        kelas: String(d.kelas || '').trim(),
        status: statusStr,
        foto: String(d.foto || '').trim(),
        ruang: String(d.ruang || '').trim()
      });
    });

    students.sort((a, b) => (Number(a.no) - Number(b.no)) || a.nisn.localeCompare(b.nisn));
    return { success: true, counts: { total, aktif, tidakAktif }, students };
  },

  async getStudentsAdmin(sessionToken) {
    const res = await handlers.getLiveDashboardData(sessionToken);
    if (!res.success) return res;
    return { success: true, data: res.students };
  },

  async unlockStudentAdmin(nisn, sessionToken) {
    const auth = requireAdmin(sessionToken, false);
    if (!auth.ok) return auth.response;

    const snap = await db.collection('students')
      .where('nisn', '==', String(nisn || '').trim())
      .limit(1)
      .get();

    if (snap.empty) return { success: false, message: 'NISN siswa tidak ditemukan.' };
    await snap.docs[0].ref.update({ status: 'Belum' });
    return { success: true };
  },

  async saveStudentAdmin(data, docId, sessionToken) {
    const auth = requireAdmin(sessionToken, true);
    if (!auth.ok) return auth.response;

    const fotoStr = typeof data.foto !== 'undefined' ? String(data.foto || '').trim() : undefined;
    if (fotoStr && fotoStr.length > 250000) {
      return { success: false, message: 'Ukuran foto terlalu besar. Pilih foto yang lebih kecil.' };
    }

    const payload = {
      nisn: String(data.nisn || '').trim(),
      nama: String(data.nama || '').trim(),
      tingkat: String(data.tingkat || '').trim(),
      kelas: String(data.kelas || '').trim(),
      status: String(data.status || 'Belum').trim()
    };
    if (typeof data.ruang !== 'undefined') payload.ruang = String(data.ruang || '').trim();
    if (typeof fotoStr !== 'undefined') payload.foto = fotoStr;

    if (docId) {
      await db.collection('students').doc(String(docId)).update(payload);
    } else {
      const countSnap = await db.collection('students').count().get();
      await db.collection('students').add({
        no: countSnap.data().count + 1,
        ruang: payload.ruang || '',
        foto: payload.foto || '',
        ...payload
      });
    }
    return { success: true };
  },

  async importStudentsAdmin(rows, sessionToken) {
    const auth = requireAdmin(sessionToken, true);
    if (!auth.ok) return auth.response;
    if (!Array.isArray(rows) || rows.length === 0) {
      return { success: false, message: 'Tidak ada data siswa yang valid pada file Excel.' };
    }

    const existingSnap = await db.collection('students').get();
    const existingMap = {};
    existingSnap.forEach(doc => {
      const nisn = String(doc.data().nisn || '').trim();
      if (nisn) existingMap[nisn] = doc.ref;
    });

    let nextNo = existingSnap.size + 1;
    let inserted = 0, updated = 0, skipped = 0;
    let batch = db.batch();
    let opCount = 0;

    for (const item of rows) {
      const nisn = String(item.nisn || '').trim();
      const nama = String(item.nama || '').trim();
      if (!nisn || !nama) { skipped++; continue; }

      const fields = {
        nisn,
        nama,
        tingkat: String(item.tingkat || '').trim(),
        kelas: String(item.kelas || '').trim(),
        status: String(item.status || 'Belum').trim() || 'Belum',
        ruang: String(item.ruang || '').trim()
      };

      if (existingMap[nisn]) {
        batch.update(existingMap[nisn], fields);
        updated++;
      } else {
        const ref = db.collection('students').doc();
        batch.set(ref, { no: nextNo++, foto: '', ...fields });
        existingMap[nisn] = ref;
        inserted++;
      }

      opCount++;
      if (opCount >= 400) {
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      }
    }
    if (opCount > 0) await batch.commit();

    return { success: true, inserted, updated, skipped };
  },

  async deleteStudentAdmin(docId, sessionToken) {
    const auth = requireAdmin(sessionToken, true);
    if (!auth.ok) return auth.response;
    if (docId) await db.collection('students').doc(String(docId)).delete();
    return { success: true };
  },

  async getSoalAdmin(sessionToken) {
    const auth = requireAdmin(sessionToken, false);
    if (!auth.ok) return auth.response;

    const snap = await db.collection('soal').get();
    const data = snap.docs.map((doc, i) => {
      const d = doc.data();
      return {
        actualRow: doc.id,
        no: d.no || i + 1,
        tingkat: String(d.tingkat || '').trim(),
        mata: String(d.mata || '').trim(),
        link: String(d.link || '').trim(),
        token: String(d.token || '').trim(),
        waktu: String(d.waktu || '60').trim(),
        mulai: String(d.mulai || '').trim(),
        selesai: String(d.selesai || '').trim()
      };
    });
    return { success: true, data };
  },

  async saveSoalAdmin(data, docId, sessionToken) {
    const auth = requireAdmin(sessionToken, true);
    if (!auth.ok) return auth.response;

    const payload = {
      tingkat: String(data.tingkat || '').trim(),
      mata: String(data.mata || '').trim(),
      link: String(data.link || '').trim(),
      token: String(data.token || '').trim(),
      waktu: Number(data.waktu) || 60,
      mulai: parseWibInputToIso(data.mulai),
      selesai: parseWibInputToIso(data.selesai)
    };

    if (docId) {
      await db.collection('soal').doc(String(docId)).update(payload);
    } else {
      const countSnap = await db.collection('soal').count().get();
      await db.collection('soal').add({ no: countSnap.data().count + 1, ...payload });
    }
    return { success: true };
  },

  async deleteSoalAdmin(docId, sessionToken) {
    const auth = requireAdmin(sessionToken, true);
    if (!auth.ok) return auth.response;
    if (docId) await db.collection('soal').doc(String(docId)).delete();
    return { success: true };
  },

  async getPengawasAdmin(sessionToken) {
    const auth = requireAdmin(sessionToken, false);
    if (!auth.ok) return auth.response;

    const snap = await db.collection('pengawas').get();
    const data = snap.docs.map(doc => {
      const d = doc.data();
      return {
        actualRow: doc.id,
        user: String(d.user || '').trim(),
        nama: String(d.nama || '').trim(),
        role: String(d.role || 'Pengawas').trim()
      };
    });
    return { success: true, data };
  },

  async savePengawasAdmin(data, docId, sessionToken) {
    const auth = requireAdmin(sessionToken, true);
    if (!auth.ok) return auth.response;

    const cleanUser = String(data.user || '').trim();
    const cleanNama = String(data.nama || '').trim();
    const cleanRole = String(data.role || 'Pengawas').trim();
    const rawPass = String(data.pass || '').trim();

    const dupSnap = await db.collection('pengawas').where('user', '==', cleanUser).get();
    const hasDup = dupSnap.docs.some(d => d.id !== String(docId || ''));
    if (hasDup) {
      return { success: false, message: 'Username sudah digunakan!' };
    }

    if (docId) {
      const updates = { user: cleanUser, nama: cleanNama, role: cleanRole };
      if (rawPass) updates.pass = hashPassword(rawPass);
      await db.collection('pengawas').doc(String(docId)).update(updates);
    } else {
      if (!rawPass) return { success: false, message: 'Password wajib diisi untuk akun baru!' };
      await db.collection('pengawas').add({
        user: cleanUser,
        pass: hashPassword(rawPass),
        nama: cleanNama,
        role: cleanRole,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    return { success: true };
  },

  async deletePengawasAdmin(docId, sessionToken) {
    const auth = requireAdmin(sessionToken, true);
    if (!auth.ok) return auth.response;
    if (docId) await db.collection('pengawas').doc(String(docId)).delete();
    return { success: true };
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    await ensureInitialSeed();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { action, args } = body;

    if (!action || typeof handlers[action] !== 'function') {
      return res.status(400).json({ success: false, message: 'Aksi tidak valid.' });
    }

    const result = await handlers[action](...(Array.isArray(args) ? args : []));
    return res.status(200).json(result);
  } catch (err) {
    console.error('[API RPC ERROR]', err);
    return res.status(500).json({ success: false, message: err.message || 'Terjadi kesalahan pada server Firebase.' });
  }
}
