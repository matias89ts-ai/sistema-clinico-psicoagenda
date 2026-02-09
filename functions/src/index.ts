import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import nodemailer from "nodemailer";
import { getFirestore } from "firebase-admin/firestore";

admin.initializeApp();
const db = getFirestore("bd-agendamati");

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
});

const MI_WHATSAPP = "56946217905"; 
const LINK_WHATSAPP = `https://wa.me/${MI_WHATSAPP}`;

const formatearFechaLatina = (f: any) => { 
    if (!f) return ""; 
    const p = f.split("-"); 
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : f; 
};

async function verificarRecaptcha(token: string) {
    if (!token) return false;
    const secret = process.env.RECAPTCHA_SECRET;
    try {
        const response = await fetch(`https://www.google.com/recaptcha/api/siteverify?secret=${secret}&response=${token}`, {
            method: "POST"
        });
        const data: any = await response.json();
        return data.success && data.score > 0.4;
    } catch (e) { return false; }
}

const generarCuerpoMail = (titulo: string, contenido: string, accionHtml: string = "") => `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: 'Inter', Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; margin-top: 20px; }
    .header { background: #0f172a; color: #ffffff; padding: 40px 20px; text-align: center; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 300; letter-spacing: 4px; text-transform: uppercase; }
    .body { padding: 40px 30px; }
    .button { display: inline-block; padding: 14px 30px; background: #0f172a; color: #ffffff !important; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 20px; }
    .footer { padding: 25px; text-align: center; font-size: 11px; color: #94a3b8; background: #f8fafc; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>PS. MATÍAS TRASLAVIÑA</h1></div>
    <div class="body">
      <h2 style="color:#0f172a; font-size:18px; margin-bottom:15px;">${titulo}</h2>
      ${contenido}
      <div style="text-align:center;">${accionHtml}</div>
    </div>
    <div class="footer">© 2026 psmtraslavina.cl | Viña del Mar, Chile</div>
  </div>
</body>
</html>`;

// --- RESERVA Y DETECCIÓN DE REINCIDENCIA ---
export const reservarHora = onCall({ cors: true, region: "southamerica-west1" }, async (request) => {
    const data = request.data;
    const esHumano = await verificarRecaptcha(data.recaptchaToken);
    if (!esHumano) throw new HttpsError("permission-denied", "Validación fallida.");

    const phoneId = data.telefono.replace(/\D/g, ''); 
    if (!data.nombre || !data.email || !data.fecha || !data.hora || !phoneId) {
        throw new HttpsError("invalid-argument", "Datos incompletos.");
    }

    const citasRef = db.collection("citas");
    const pacienteRef = db.collection("pacientes").doc(phoneId);

    const prevCitasSnap = await citasRef.where("telefono", "==", data.telefono).get();
    const citasAnteriores = prevCitasSnap.docs
        .filter(d => d.data().estado !== "cancelado")
        .map(d => `${formatearFechaLatina(d.data().fecha)} a las ${d.data().hora}`);
    
    const esAntiguo = citasAnteriores.length > 0;
    let alertaAdmin = "";

    if (esAntiguo) {
        alertaAdmin = `⚠️ Paciente "${data.nombre}" antiguo volvió a agendar sesión.\n`;
        alertaAdmin += `📍 Tiene ${citasAnteriores.length + 1} agendamientos registrados.\n`;
        alertaAdmin += `📅 Historial: ${citasAnteriores.join(", ")}.`;
    }

    return db.runTransaction(async (t) => {
        const q = citasRef.where("fecha", "==", data.fecha).where("hora", "==", data.hora);
        const s = await t.get(q);
        if (s.docs.find(d => d.data().estado !== "cancelado")) throw new HttpsError("already-exists", "Ocupado.");
        
        t.set(citasRef.doc(), { 
            ...data, 
            pacienteId: phoneId, 
            estado: "confirmada", 
            alertaSistema: alertaAdmin,
            createdAt: admin.firestore.FieldValue.serverTimestamp() 
        });

        t.set(pacienteRef, {
            nombre: data.nombre,
            email: data.email,
            telefono: data.telefono,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

    }).then(async () => {
        const contenido = `<p>Hola <strong>${data.nombre}</strong>,</p><p>He recibido tu solicitud para el <strong>${formatearFechaLatina(data.fecha)}</strong> a las <strong>${data.hora} hrs</strong>.</p>`;
        const btnWsp = `<a href="${LINK_WHATSAPP}" class="button" style="background:#25d366;">CONTACTAR VÍA WHATSAPP</a>`;
        await transporter.sendMail({ from: `"Ps. Matías Traslaviña" <${process.env.GMAIL_USER}>`, to: data.email, subject: `Reserva Recibida`, html: generarCuerpoMail("Confirmación de Sesión", contenido, btnWsp) });

        if (esAntiguo) {
            await transporter.sendMail({
                from: `"Sistema psmtraslavina.cl" <${process.env.GMAIL_USER}>`,
                to: process.env.GMAIL_USER,
                subject: `REINCIDENCIA: ${data.nombre} ha vuelto a agendar`,
                text: alertaAdmin
            });
        }
        return { success: true };
    });
});

export const obtenerDisponibilidadMes = onCall({ cors: true, region: "southamerica-west1" }, async (req) => {
    const p = `${req.data.year}-${req.data.month.toString().padStart(2,"0")}`;
    const s = await db.collection("citas").where("fecha", ">=", `${p}-01`).where("fecha", "<=", `${p}-31`).get();
    return s.docs.filter(d => d.data().estado !== "cancelado").map(d => ({ fecha: d.data().fecha, hora: d.data().hora }));
});

// --- RESTAURACIÓN DE FUNCIONES ADMINISTRATIVAS ---
export const listarPacientes = onCall({ cors: true, region: "southamerica-west1" }, async () => {
    const snap = await db.collection("pacientes").orderBy("nombre").get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
});

export const obtenerHistorialClinico = onCall({ cors: true, region: "southamerica-west1" }, async (req) => {
    const snap = await db.collection("pacientes").doc(req.data.idPaciente).collection("historial").orderBy("createdAt", "desc").get();
    return snap.docs.map(d => ({ id: d.id, ...d.data(), created: d.data().createdAt?.toDate().toISOString() }));
});

export const obtenerMetricas = onCall({ cors: true, region: "southamerica-west1" }, async () => {
    const snapP = await db.collection("pacientes").count().get();
    const snapC = await db.collection("citas").where("estado", "==", "confirmada").count().get();
    return { pacientes: snapP.data().count, citas: snapC.data().count };
});
