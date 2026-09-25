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

app.get("/api10/health", (_req, res) => res.json({ ok: true, service: "api10-ordenes" }));
const PORT = 3010;
app.listen(PORT, () => {
  console.log(`API10 escuchando en http://localhost:${PORT}/api10/health :)`);
});

