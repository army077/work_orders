// index.js
const express = require("express");
const cors = require("cors");
const productos = require("./routes/productos");
const bom = require("./routes/bom");
const alternativos = require("./routes/alternativos");
const reemplazos = require("./routes/reemplazos");
const bomsCrud = require("./routes/boms_crud");
const bomSecciones = require("./routes/bom_secciones");
const unidades = require("./routes/unidades_medida");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.use("/api15/productos", productos);
app.use("/api15/boms", bom);
app.use("/api15/alternativos", alternativos);
app.use("/api15/reemplazos", reemplazos);
app.use("/api15/boms-crud", bomsCrud);
app.use("/api15/bom-secciones", bomSecciones);
app.use("/api15/unidades-medida", unidades);

const PORT = process.env.PORT || 3015;
app.listen(PORT, () => console.log(`🔥 API BOMs corriendo en puerto ${PORT}`));
