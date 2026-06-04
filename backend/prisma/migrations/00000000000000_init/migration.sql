-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "created_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "password_salt" TEXT NOT NULL,
    "password_iterations" INTEGER NOT NULL DEFAULT 100000,
    "password_hash" TEXT NOT NULL,
    "profile" JSONB NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" UUID NOT NULL,
    "created_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "last_used" TIMESTAMPTZ,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timesheet" (
    "id" UUID NOT NULL,
    "created_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,
    "employee_name" TEXT,
    "employee_number" TEXT,
    "month" TEXT,
    "year" INTEGER,
    "department" TEXT,
    "source_filename" TEXT,
    "source_file_url" TEXT,
    "total_compensation_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_descanso_compensatorio_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" UUID NOT NULL,
    "created_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "full_name" TEXT NOT NULL,
    "employee_number" TEXT,
    "email" TEXT NOT NULL,
    "department" TEXT,
    "function" TEXT,
    "company" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetRecord" (
    "id" UUID NOT NULL,
    "created_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,
    "timesheet_id" UUID,
    "employee_name" TEXT NOT NULL,
    "employee_number" TEXT,
    "month" TEXT,
    "year" INTEGER,
    "date" DATE NOT NULL,
    "normal_hours" DOUBLE PRECISION,
    "extra_hours" DOUBLE PRECISION,
    "travel_hours" DOUBLE PRECISION,
    "absence_hours" DOUBLE PRECISION,
    "day_type" TEXT,
    "absence_type" TEXT,
    "project_number" TEXT,
    "project_client" TEXT,
    "project_description" TEXT,
    "compensated" BOOLEAN NOT NULL DEFAULT false,
    "period_start" TEXT,
    "period_end" TEXT,
    "pause_hours" DOUBLE PRECISION,
    "status" TEXT,
    "observations" TEXT,

    CONSTRAINT "TimesheetRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompensationEnjoyment" (
    "id" UUID NOT NULL,
    "created_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID NOT NULL,
    "enjoy_date" DATE NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,

    CONSTRAINT "CompensationEnjoyment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceStore" (
    "key" TEXT NOT NULL,
    "created_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "value" JSONB NOT NULL,

    CONSTRAINT "ReferenceStore_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_token_hash_key" ON "UserSession"("token_hash");

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetRecord" ADD CONSTRAINT "TimesheetRecord_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetRecord" ADD CONSTRAINT "TimesheetRecord_timesheet_id_fkey" FOREIGN KEY ("timesheet_id") REFERENCES "Timesheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompensationEnjoyment" ADD CONSTRAINT "CompensationEnjoyment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

