BEGIN;

CREATE TABLE maquinas_normalizado (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX maquinas_normalizado_name_key ON maquinas_normalizado (lower(btrim(name)));

CREATE TABLE engineering_document (
    id SERIAL PRIMARY KEY,
    maquina_id INTEGER NOT NULL REFERENCES maquinas_normalizado(id) ON DELETE RESTRICT,
    code TEXT NOT NULL CHECK (length(btrim(code)) BETWEEN 1 AND 80),
    title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 250),
    document_type TEXT NOT NULL DEFAULT 'INSTALACION_EXITOSA'
        CHECK (document_type = 'INSTALACION_EXITOSA'),
    created_by TEXT NOT NULL CHECK (length(btrim(created_by)) BETWEEN 1 AND 200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (maquina_id, document_type)
);
CREATE UNIQUE INDEX engineering_document_code_key ON engineering_document (lower(btrim(code)));

CREATE TABLE engineering_document_version (
    id SERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES engineering_document(id) ON DELETE RESTRICT,
    revision INTEGER NOT NULL CHECK (revision > 0),
    pdf_url TEXT NOT NULL CHECK (length(pdf_url) <= 2048 AND pdf_url ~* '^https?://[^[:space:]]+$'),
    change_summary TEXT NOT NULL CHECK (length(btrim(change_summary)) BETWEEN 1 AND 4000),
    status TEXT NOT NULL DEFAULT 'BORRADOR'
        CHECK (status IN ('BORRADOR', 'VIGENTE', 'OBSOLETO', 'RETIRADO')),
    created_by TEXT NOT NULL CHECK (length(btrim(created_by)) BETWEEN 1 AND 200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_by TEXT,
    published_at TIMESTAMPTZ,
    retired_by TEXT,
    retired_at TIMESTAMPTZ,
    retirement_reason TEXT CHECK (length(retirement_reason) <= 2000),
    UNIQUE (document_id, revision),
    CHECK ((published_at IS NULL) = (published_by IS NULL)),
    CHECK (status NOT IN ('VIGENTE', 'OBSOLETO') OR published_at IS NOT NULL),
    CHECK (
        (status = 'RETIRADO' AND retired_at IS NOT NULL AND retired_by IS NOT NULL AND retirement_reason IS NOT NULL
            AND length(btrim(retirement_reason)) > 0)
        OR (status <> 'RETIRADO' AND retired_at IS NULL AND retired_by IS NULL AND retirement_reason IS NULL)
    )
);
CREATE UNIQUE INDEX engineering_document_one_current
    ON engineering_document_version (document_id) WHERE status = 'VIGENTE';

CREATE TABLE engineering_document_event (
    id SERIAL PRIMARY KEY,
    maquina_id INTEGER NOT NULL REFERENCES maquinas_normalizado(id) ON DELETE RESTRICT,
    document_id INTEGER REFERENCES engineering_document(id) ON DELETE RESTRICT,
    version_id INTEGER REFERENCES engineering_document_version(id) ON DELETE RESTRICT,
    action TEXT NOT NULL CHECK (action IN (
        'MAQUINA_CREADA', 'MAQUINA_ACTUALIZADA', 'DOCUMENTO_CREADO', 'DOCUMENTO_ACTUALIZADO',
        'VERSION_CREADA', 'BORRADOR_ACTUALIZADO', 'VERSION_PUBLICADA', 'VERSION_OBSOLETA', 'VERSION_RETIRADA'
    )),
    actor TEXT NOT NULL CHECK (length(btrim(actor)) BETWEEN 1 AND 200),
    reason TEXT NOT NULL DEFAULT '',
    before_data JSONB,
    after_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (version_id IS NULL OR document_id IS NOT NULL)
);
CREATE INDEX engineering_document_event_document_idx ON engineering_document_event(document_id, id DESC);
CREATE INDEX engineering_document_event_machine_idx ON engineering_document_event(maquina_id, id DESC);

COMMIT;
