CREATE TABLE "work_order" (
	"id" SERIAL NOT NULL,
	"template_id" INTEGER NOT NULL,
	"template_version" INTEGER NOT NULL,
	"model_id" INTEGER NULL DEFAULT NULL,
	"machine_serial" TEXT NULL DEFAULT NULL,
	"customer_name" TEXT NULL DEFAULT NULL,
	"site_address" TEXT NULL DEFAULT NULL,
	"assigned_tech_email" TEXT NULL DEFAULT NULL,
	"status" TEXT NULL DEFAULT 'OPEN',
	"scheduled_at" TIMESTAMPTZ NULL DEFAULT NULL,
	"started_at" TIMESTAMPTZ NULL DEFAULT NULL,
	"finished_at" TIMESTAMPTZ NULL DEFAULT NULL,
	"created_at" TIMESTAMPTZ NULL DEFAULT NULL,
	"diagnostic_result" VARCHAR(255) NULL DEFAULT NULL::character varying,
	"tech_support" VARCHAR(255) NULL DEFAULT NULL,
	"folio_sai" VARCHAR(255) NULL DEFAULT NULL,
	"initial_status" VARCHAR(255) NULL DEFAULT NULL::character varying,
	"comments" VARCHAR(1000) NULL DEFAULT NULL,
	"extra_points" NUMERIC NULL DEFAULT NULL,
	"id_reserva" INTEGER NULL DEFAULT NULL,
	PRIMARY KEY ("id"),
	INDEX "idx_work_order_diagnostic_result" ("diagnostic_result"),
	CONSTRAINT "work_order_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "machine_model" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
	CONSTRAINT "work_order_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "maintenance_template" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT
)
;

CREATE TABLE "work_order_task" (
	"id" SERIAL NOT NULL,
	"work_order_id" INTEGER NOT NULL,
	"section_title" TEXT NOT NULL,
	"task_title" TEXT NOT NULL,
	"code" TEXT NULL DEFAULT NULL,
	"expected_minutes" INTEGER NOT NULL DEFAULT 0,
	"position" INTEGER NOT NULL,
	"status" VARCHAR NULL DEFAULT NULL,
	"observation" TEXT NULL DEFAULT NULL,
	"actual_minutes" INTEGER NULL DEFAULT NULL,
	"photo_url" TEXT NULL DEFAULT NULL,
	"started_at" TIMESTAMPTZ NULL DEFAULT NULL,
	"finished_at" TIMESTAMPTZ NULL DEFAULT NULL,
	"category" VARCHAR(255) NULL DEFAULT 'Mantenimiento',
	"extra_data" JSONB NULL DEFAULT '{}',
	PRIMARY KEY ("id"),
	UNIQUE INDEX "work_order_task_work_order_id_position_key" ("work_order_id", "position"),
	CONSTRAINT "work_order_task_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_order" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
)
;

CREATE TABLE "work_order_customs" (
	"id" SERIAL NOT NULL,
	"work_order_id" INTEGER NULL DEFAULT NULL,
	"custom_title" VARCHAR(255) NULL DEFAULT NULL,
	"custom_value" NUMERIC NULL DEFAULT NULL,
	PRIMARY KEY ("id"),
	CONSTRAINT "work_order_customs_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_order" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
)
;

CREATE TABLE "maintenance_template" (
	"id" SERIAL NOT NULL,
	"name" TEXT NOT NULL,
	"template_type" TEXT NOT NULL,
	"model_id" INTEGER NULL DEFAULT NULL,
	"version" INTEGER NOT NULL DEFAULT 1,
	"is_published" BOOLEAN NOT NULL DEFAULT false,
	"created_by" TEXT NULL DEFAULT NULL,
	"created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
	"updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY ("id"),
	CONSTRAINT "maintenance_template_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "machine_model" ("id") ON UPDATE NO ACTION ON DELETE SET NULL,
	CONSTRAINT "maintenance_template_template_type_check" CHECK (((template_type = ANY (ARRAY['MANTENIMIENTO'::text, 'INSTALACION'::text, 'DIAGNOSTICO'::text, 'REPARACION'::text, 'ENSAMBLE'::text, 'INSPECCION'::text]))))
)
;

CREATE TABLE "template_section" (
	"id" SERIAL NOT NULL,
	"template_id" INTEGER NOT NULL,
	"title" TEXT NOT NULL,
	"position" INTEGER NOT NULL,
	PRIMARY KEY ("id"),
	UNIQUE INDEX "template_section_template_id_position_key" ("template_id", "position"),
	INDEX "idx_section_template" ("template_id", "position")
)
;

CREATE TABLE "template_task" (
	"id" SERIAL NOT NULL,
	"section_id" INTEGER NOT NULL,
	"code" TEXT NULL DEFAULT NULL,
	"title" TEXT NOT NULL,
	"expected_minutes" INTEGER NOT NULL DEFAULT 0,
	"required" BOOLEAN NOT NULL DEFAULT true,
	"position" INTEGER NOT NULL,
	"category" VARCHAR(255) NULL DEFAULT 'Mantenimiento',
	PRIMARY KEY ("id"),
	UNIQUE INDEX "template_task_section_id_position_key" ("section_id", "position"),
	INDEX "idx_task_section" ("section_id", "position"),
	CONSTRAINT "template_task_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "template_section" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
)
;

CREATE TABLE "template_task_inspection" (
	"id" SERIAL NOT NULL,
	"section_id" INTEGER NOT NULL,
	"revision_point" TEXT NOT NULL,
	"specs" TEXT NULL DEFAULT NULL,
	"suggestions" TEXT NULL DEFAULT NULL,
	"required" BOOLEAN NULL DEFAULT true,
	"position" INTEGER NOT NULL DEFAULT 1,
	"category" TEXT NULL DEFAULT 'Mecanica',
	PRIMARY KEY ("id")
)
;

CREATE TABLE "machine_family" (
	"id" SERIAL NOT NULL,
	"name" TEXT NOT NULL,
	PRIMARY KEY ("id")
)
;

CREATE TABLE "machine_model" (
	"id" SERIAL NOT NULL,
	"family_id" INTEGER NULL DEFAULT NULL,
	"name" TEXT NOT NULL,
	"manufacturer" TEXT NULL DEFAULT NULL,
	"bond_value" NUMERIC NULL DEFAULT NULL,
	"standard_days" NUMERIC NULL DEFAULT NULL,
	PRIMARY KEY ("id"),
	UNIQUE INDEX "machine_model_family_id_name_key" ("family_id", "name"),
	CONSTRAINT "machine_model_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "machine_family" ("id") ON UPDATE NO ACTION ON DELETE SET NULL
)
;

CREATE TABLE "machine_customs" (
	"id" SERIAL NOT NULL,
	"custom_title" TEXT NOT NULL,
	"custom_value" NUMERIC(10,2) NOT NULL,
	PRIMARY KEY ("id")
)
;

CREATE TABLE "inspection_order" (
	"id" SERIAL NOT NULL,
	"inspection_template_id" INTEGER NULL DEFAULT NULL,
	"model_id" INTEGER NULL DEFAULT NULL,
	"assigned_tech_email" VARCHAR(255) NULL DEFAULT NULL::character varying,
	"status" VARCHAR(50) NULL DEFAULT 'PENDING',
	"created_at" TIMESTAMP NULL DEFAULT now(),
	"started_at" TIMESTAMP NULL DEFAULT NULL,
	"finished_at" TIMESTAMP NULL DEFAULT NULL,
	"work_order_id" INTEGER NULL DEFAULT NULL,
	"estacion" INTEGER NULL DEFAULT NULL,
	"inspection_type" VARCHAR(255) NULL DEFAULT NULL::character varying,
	"evidencias" JSONB NULL DEFAULT NULL,
	PRIMARY KEY ("id"),
	CONSTRAINT "inspection_order_inspection_template_id_fkey" FOREIGN KEY ("inspection_template_id") REFERENCES "maintenance_template" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
	CONSTRAINT "inspection_order_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "machine_model" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION
)
;

CREATE TABLE "inspection_order_task" (
	"id" SERIAL NOT NULL,
	"inspection_order_id" INTEGER NULL DEFAULT NULL,
	"template_task_inspection_id" INTEGER NULL DEFAULT NULL,
	"revision_point" VARCHAR(500) NULL DEFAULT NULL,
	"specs" TEXT NULL DEFAULT NULL,
	"suggestions" TEXT NULL DEFAULT NULL,
	"status" VARCHAR(50) NULL DEFAULT 'PENDING',
	"started_at" TIMESTAMP NULL DEFAULT NULL,
	"finished_at" TIMESTAMP NULL DEFAULT NULL,
	"actual_minutes" INTEGER NULL DEFAULT NULL,
	"comments" TEXT NULL DEFAULT NULL,
	"section_title" TEXT NULL DEFAULT NULL,
	"position" INTEGER NULL DEFAULT NULL,
	PRIMARY KEY ("id")
)
;

CREATE TABLE "desviaciones_calidad" (
	"id" SERIAL NOT NULL,
	"id_actividad" INTEGER NOT NULL,
	"correo" VARCHAR(120) NULL DEFAULT NULL,
	"usuario" VARCHAR(120) NULL DEFAULT NULL,
	"created_at" TIMESTAMP NOT NULL DEFAULT now(),
	"serial_number" VARCHAR(120) NULL DEFAULT NULL,
	"afected_machine" VARCHAR(200) NULL DEFAULT NULL,
	"num_revision" INTEGER NULL DEFAULT NULL,
	"nombre_tecnico" VARCHAR(120) NULL DEFAULT NULL,
	"parte_afectada" VARCHAR(200) NULL DEFAULT NULL,
	"causa_raiz" VARCHAR(200) NULL DEFAULT NULL,
	"clasificacion_defecto" VARCHAR(120) NULL DEFAULT NULL,
	"tipo_defectivo" VARCHAR(120) NULL DEFAULT NULL,
	"clasificacion_defectivo" VARCHAR(200) NULL DEFAULT NULL,
	"comentarios" TEXT NULL DEFAULT NULL,
	"evidencias" JSONB NULL DEFAULT NULL,
	PRIMARY KEY ("id")
)
;

CREATE TABLE "prod_delayments" (
	"id" SERIAL NOT NULL,
	"id_actividad" INTEGER NULL DEFAULT NULL,
	"categoria_retraso" VARCHAR(255) NULL DEFAULT NULL,
	"tiempo_retraso" DOUBLE PRECISION NULL DEFAULT NULL,
	"comments" VARCHAR(1000) NULL DEFAULT NULL,
	PRIMARY KEY ("id"),
	CONSTRAINT "prod_delayments_id_actividad_fkey" FOREIGN KEY ("id_actividad") REFERENCES "work_order_task" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
)
;

CREATE TABLE "plantilla_tecnicos" (
	"id" SERIAL NOT NULL,
	"estatus" VARCHAR(50) NOT NULL,
	"sucursal" VARCHAR(50) NOT NULL,
	"nombre_tecnico" VARCHAR(50) NULL DEFAULT NULL,
	"correo_tecnico" VARCHAR(70) NOT NULL,
	"telefono" VARCHAR(20) NULL DEFAULT NULL,
	"puesto" VARCHAR(50) NULL DEFAULT NULL,
	"nombre_bonos" VARCHAR(70) NOT NULL,
	"numero_empleado" INTEGER NULL DEFAULT NULL,
	PRIMARY KEY ("id")
)
;