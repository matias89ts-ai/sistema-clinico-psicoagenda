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

export const reservarHora = onCall({ cors: true, region: "southamerica-west1" }, async (request) => {
    const data = request.data;
    const esHumano = await verificarRecaptcha(data.recaptchaToken);
    if (!esHumano) throw new HttpsError("permission-denied", "Seguridad fallida.");

    const phoneId = data.telefono.replace(/\D/g, ''); 
    if (!data.nombre || !phoneId) throw new HttpsError("invalid-argument", "Datos incompletos.");

    const citasRef = db.collection("citas");
    const pacienteRef = db.collection("pacientes").doc(phoneId);

    // Búsqueda de reincidencia por teléfono
    const prevCitasSnap = await citasRef.where("telefono", "==", data.telefono).get();
    const activas = prevCitasSnap.docs.filter(d => d.data().estado !== "cancelado");
    const esAntiguo = activas.length > 0;

    return db.runTransaction(async (t) => {
        const q = citasRef.where("fecha", "==", data.fecha).where("hora", "==", data.hora);
        const s = await t.get(q);
        if (s.docs.find(d => d.data().estado !== "cancelado")) throw new HttpsError("already-exists", "Ocupado.");
        
        t.set(citasRef.doc(), { 
            ...data, 
            pacienteId: phoneId, 
            estado: "confirmada", 
            createdAt: admin.firestore.FieldValue.serverTimestamp() 
        });

        t.set(pacienteRef, {
            nombre: data.nombre,
            email: data.email,
            telefono: data.telefono,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

    }).then(async () => {
        // Mail al paciente
        await transporter.sendMail({
            from: `"Ps. Matías Traslaviña" <${process.env.GMAIL_USER}>`,
            to: data.email,
            subject: `Cita Agendada: ${formatearFechaLatina(data.fecha)}`,
            html: `<p>Hola ${data.nombre}, tu reserva para el ${formatearFechaLatina(data.fecha)} a las ${data.hora} ha sido confirmada.</p>`
        });
        // Alerta interna a Matías si es antiguo
        if (esAntiguo) {
            await transporter.sendMail({
                from: `"Sistema psmtraslavina.cl" <${process.env.GMAIL_USER}>`,
                to: process.env.GMAIL_USER,
                subject: `REINCIDENCIA: ${data.nombre} ha vuelto a agendar`,
                text: `Paciente antiguo con ${activas.length} registros previos ha agendado para el ${data.fecha}.`
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

export const listarPacientes = onCall({ cors: true, region: "southamerica-west1" }, async () => {
    const snap = await db.collection("pacientes").orderBy("nombre").get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
});

export const obtenerMetricas = onCall({ cors: true, region: "southamerica-west1" }, async () => {
    const snapP = await db.collection("pacientes").count().get();
    return { pacientes: snapP.data().count };
});

export const obtenerHistorialClinico = onCall({ cors: true, region: "southamerica-west1" }, async (req) => {
    const snap = await db.collection("pacientes").doc(req.data.idPaciente).collection("historial").orderBy("createdAt", "desc").get();
    return snap.docs.map(d => ({ id: d.id, ...d.data(), created: d.data().createdAt?.toDate().toISOString() }));
});
