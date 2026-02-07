Sistema de Gestión Clínica (EMR Lite) - Serverless Architecture

Este proyecto es un sistema integral de agendamiento y gestión de fichas clínicas diseñado para profesionales de la salud mental. Implementa una arquitectura Serverless moderna sobre Google Cloud Platform (GCP) y Firebase.

Arquitectura Técnica

Backend: Firebase Cloud Functions (Node.js/TypeScript) con arquitectura de microservicios.

Base de Datos: Firestore (NoSQL) con implementación de transacciones ACID para control de concurrencia en reservas.

Frontend: SPA (Single Page Application) reactiva utilizando Vanilla JS y Tailwind CSS.

Seguridad: Integración de Google reCAPTCHA v3 y validación de sesiones en el lado del servidor.

Infraestructura: Despliegue multi-región distribuido (Santiago/US) para optimización de latencia y servicios auxiliares (Cloud Scheduler).


Funcionalidades Clave

Agendamiento Inteligente: Sistema con lógica de negocio que bloquea reservas con menos de 24h de antelación y gestiona zonas horarias.

Automatización (CronJobs): Tareas programadas para envío de recordatorios de pago y confirmación de citas vía Email (Nodemailer).



Ficha Clínica EMR: Gestión de historial de evolución de pacientes con sub-colecciones segregadas en Firestore.

Integraciones: Generación dinámica de deep-links para API de WhatsApp y webhooks de respuesta transaccional por correo.



Autor

Matías Traslaviña Santana Ingeniero de Software & Psicólogo Clínico