const express = require("express");
const cors = require("cors");
const templates = require("./routes/templates");
const sections = require("./routes/sections");
const tasks = require("./routes/tasks");
const workOrders = require("./routes/workOrders");
const machineFamilies = require("./routes/machineFamilies");
const machineModels = require("./routes/machineModels");
const customs = require("./routes/customs");
const bonds = require("./routes/productionBonds");
const quality = require('./routes/quality');
const logisticaDeliveries = require('./routes/logisticaDeliveries');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api10/templates', templates);
app.use('/api10/sections', sections);
app.use('/api10/tasks', tasks);
app.use('/api10/work-orders', workOrders);
app.use("/api10/machine-families", machineFamilies);
app.use("/api10/machine-models", machineModels);
app.use('/api10/customs', customs);
app.use('/api10/bonds', bonds);
app.use('/api10/quality', quality);
app.use('/api10/logistica', logisticaDeliveries);

// El parser JSON global puede fallar antes de alcanzar el router. Esta respuesta
// se limita al nuevo POST; los errores de las rutas existentes siguen su flujo.
app.use('/api10/logistica/entregas', (err, req, res, next) => {
  if (req.method !== 'POST' || res.headersSent) return next(err);
  if ([
    'entity.parse.failed', 'entity.too.large', 'request.size.invalid',
    'charset.unsupported', 'encoding.unsupported',
  ].includes(err.type)) {
    return res.status(400).json({ error: 'JSON inválido o no admitido' });
  }
  console.error('Error procesando entrega logística:', err.code || 'INTERNAL_ERROR');
  return res.status(500).json({ error: 'No se pudo procesar la entrega' });
});

// Diagnóstico de autenticación: solo LOCAL/TEST, nunca en producción.
if (["local", "test"].includes(String(process.env.APP_ENV || "").toLowerCase())) {
  app.use('/api10/auth/logistica', require("./routes/authLogistica"));
}

app.get("/api10/health", (_req, res) => res.json({ ok: true, service: "api10-ordenes" }));
const PORT = 3010;
app.listen(PORT, () => {
  console.log(`API10 escuchando en http://localhost:${PORT}/api10/health :)`);
});

