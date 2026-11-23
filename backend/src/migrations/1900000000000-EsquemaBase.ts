import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Esquema base unico del entorno local.
 *
 * Sustituye a las migraciones historicas: es el resultado de aplicarlas todas
 * sobre una base vacia (PostgreSQL 16), volcado con `pg_dump`, mas los datos de
 * referencia que ellas sembraban (reglamento, ajustes de liquidacion y de
 * transporte). El administrador inicial lo crea `UserSeederService` al arrancar.
 *
 * No hay `down`: una base local se recrea borrando el volumen de Docker.
 */
export class EsquemaBase1900000000000 implements MigrationInterface {
  name = 'EsquemaBase1900000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(ESQUEMA_SQL);
    await queryRunner.query(DATOS_SQL);
  }

  public down(): Promise<void> {
    throw new Error(
      'El esquema base no se revierte: borra el volumen de la base local y vuelve a levantarla',
    );
  }
}

const ESQUEMA_SQL = String.raw`
--
-- PostgreSQL database dump
--


-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: client_memberships_assignment_type_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.client_memberships_assignment_type_enum AS ENUM (
    'automatic',
    'manual'
);


--
-- Name: client_memberships_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.client_memberships_status_enum AS ENUM (
    'active',
    'inactive',
    'suspended'
);


--
-- Name: conduct_reports_category_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.conduct_reports_category_enum AS ENUM (
    'trato_inadecuado',
    'demora_impuntualidad',
    'incumplimiento',
    'cobro',
    'seguridad',
    'otro'
);


--
-- Name: conversations_mode_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.conversations_mode_enum AS ENUM (
    'AI_ACTIVE',
    'HUMAN_ACTIVE'
);


--
-- Name: conversations_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.conversations_status_enum AS ENUM (
    'activa',
    'en_revision',
    'con_servicio',
    'cerrada'
);


--
-- Name: employee_onboardings_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.employee_onboardings_status_enum AS ENUM (
    'pending',
    'in_progress',
    'completed'
);


--
-- Name: employee_regulations_target_role_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.employee_regulations_target_role_enum AS ENUM (
    'empleada',
    'chofer',
    'jefe'
);


--
-- Name: employee_reports_category_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.employee_reports_category_enum AS ENUM (
    'trato_inadecuado',
    'demora_impuntualidad',
    'incumplimiento',
    'cobro',
    'seguridad',
    'otro'
);


--
-- Name: employee_reports_origin_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.employee_reports_origin_enum AS ENUM (
    'cliente',
    'chofer'
);


--
-- Name: employee_reports_priority_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.employee_reports_priority_enum AS ENUM (
    'normal',
    'alta',
    'urgente'
);


--
-- Name: employee_reports_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.employee_reports_status_enum AS ENUM (
    'nuevo',
    'en_revision',
    'resuelto',
    'descartado'
);


--
-- Name: extensiones_servicio_aceptada_por_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.extensiones_servicio_aceptada_por_enum AS ENUM (
    'cliente',
    'empleada'
);


--
-- Name: extras_servicio_metodo_pago_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.extras_servicio_metodo_pago_enum AS ENUM (
    'tarjeta',
    'transferencia',
    'efectivo'
);


--
-- Name: interaction_ratings_direction_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.interaction_ratings_direction_enum AS ENUM (
    'client_to_employee',
    'employee_to_client',
    'driver_to_employee',
    'employee_to_driver'
);


--
-- Name: loyalty_transactions_type_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.loyalty_transactions_type_enum AS ENUM (
    'earned',
    'manual_adjustment',
    'tier_assignment',
    'reversal'
);


--
-- Name: messages_sender_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.messages_sender_enum AS ENUM (
    'cliente',
    'ia',
    'jefe',
    'sistema'
);


--
-- Name: post_media_kind_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.post_media_kind_enum AS ENUM (
    'imagen',
    'video'
);


--
-- Name: posts_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.posts_status_enum AS ENUM (
    'borrador',
    'pendiente',
    'aprobado',
    'rechazado',
    'archivado'
);


--
-- Name: questionnaire_attempts_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.questionnaire_attempts_status_enum AS ENUM (
    'in_progress',
    'completed'
);


--
-- Name: servicios_estado_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.servicios_estado_enum AS ENUM (
    'pendiente',
    'agendado',
    'en_curso',
    'finalizado',
    'cancelado'
);


--
-- Name: servicios_metodo_pago_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.servicios_metodo_pago_enum AS ENUM (
    'efectivo',
    'tarjeta',
    'transferencia',
    'mixto'
);


--
-- Name: usuarios_rol_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.usuarios_rol_enum AS ENUM (
    'jefe',
    'empleada',
    'chofer',
    'admin',
    'cliente'
);


--
-- Name: viajes_estado_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.viajes_estado_enum AS ENUM (
    'notificado',
    'aceptado',
    'en_camino',
    'llegado',
    'en_curso',
    'finalizado',
    'rechazado',
    'cancelado'
);


--
-- Name: viajes_tipo_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.viajes_tipo_enum AS ENUM (
    'ida',
    'regreso'
);


--
-- Name: viajes_zona_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.viajes_zona_enum AS ENUM (
    'montecarlo',
    'majestic',
    'domicilio'
);


--
-- Name: actualizar_like_count_post(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.actualizar_like_count_post() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          UPDATE "posts" SET "like_count" = "like_count" + 1
           WHERE "id" = NEW."post_id";
        ELSIF TG_OP = 'DELETE' THEN
          UPDATE "posts" SET "like_count" = "like_count" - 1
           WHERE "id" = OLD."post_id" AND "like_count" > 0;
        END IF;
        RETURN NULL;
      END;
      $$;


--
-- Name: actualizar_metricas_empleada_desde_rating(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.actualizar_metricas_empleada_desde_rating() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          PERFORM recalcular_metricas_empleada(OLD.employee_id);
          RETURN OLD;
        END IF;
        IF TG_OP = 'UPDATE' AND OLD.employee_id IS DISTINCT FROM NEW.employee_id THEN
          PERFORM recalcular_metricas_empleada(OLD.employee_id);
        END IF;
        PERFORM recalcular_metricas_empleada(NEW.employee_id);
        RETURN NEW;
      END;
      $$;


--
-- Name: actualizar_metricas_empleada_desde_servicio(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.actualizar_metricas_empleada_desde_servicio() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          PERFORM recalcular_metricas_empleada(OLD.empleada_id);
          RETURN OLD;
        END IF;

        IF TG_OP = 'UPDATE' AND OLD.empleada_id IS DISTINCT FROM NEW.empleada_id THEN
          PERFORM recalcular_metricas_empleada(OLD.empleada_id);
        END IF;

        PERFORM recalcular_metricas_empleada(NEW.empleada_id);
        RETURN NEW;
      END;
      $$;


--
-- Name: actualizar_total_extras_servicio(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.actualizar_total_extras_servicio() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      DECLARE
          v_servicio_id UUID;
          v_total_extras NUMERIC(10,2);
      BEGIN
          IF TG_OP = 'DELETE' THEN
              v_servicio_id := OLD.servicio_id;
          ELSE
              v_servicio_id := NEW.servicio_id;
          END IF;

          SELECT COALESCE(SUM(precio_cobrado), 0)
          INTO v_total_extras
          FROM extras_servicio
          WHERE servicio_id = v_servicio_id;

          UPDATE servicios
          SET total_extras = v_total_extras
          WHERE id = v_servicio_id;

          IF TG_OP = 'DELETE' THEN
              RETURN OLD;
          ELSE
              RETURN NEW;
          END IF;
      END;
      $$;


--
-- Name: actualizar_total_pagos(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.actualizar_total_pagos() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      DECLARE v_service_id uuid;
      BEGIN
        v_service_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.service_id ELSE NEW.service_id END;
        UPDATE servicios
        SET total_paid = (
          SELECT COALESCE(SUM(amount), 0)
          FROM service_payments
          WHERE service_id = v_service_id AND status = 'aprobado'
        )
        WHERE id = v_service_id;
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
      END;
      $$;


--
-- Name: actualizar_total_participantes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.actualizar_total_participantes() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      DECLARE v_service_id uuid;
      BEGIN
        v_service_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.service_id ELSE NEW.service_id END;
        UPDATE servicios
        SET total_base = (
          SELECT COALESCE(SUM(confirmed_subtotal), 0)
          FROM service_participants
          WHERE service_id = v_service_id AND status <> 'cancelada'
        )
        WHERE id = v_service_id AND service_type = 'grupal';
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
      END;
      $$;


--
-- Name: actualizar_total_transporte_servicio(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.actualizar_total_transporte_servicio() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      DECLARE v_servicio_id UUID;
      BEGIN
        v_servicio_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.servicio_id ELSE NEW.servicio_id END;
        UPDATE servicios SET actual_transport_cost = (
          SELECT COALESCE(SUM(tarifa), 0) FROM viajes
          WHERE servicio_id = v_servicio_id AND estado NOT IN ('cancelado', 'rechazado')
        ) WHERE id = v_servicio_id;
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
      END;
      $$;


--
-- Name: calcular_distancia_haversine(double precision, double precision, double precision, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calcular_distancia_haversine(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision) RETURNS double precision
    LANGUAGE plpgsql
    AS $$
      DECLARE
          r double precision := 6371.0; -- Radio de la tierra en km
          dlat double precision;
          dlng double precision;
          a double precision;
          c double precision;
      BEGIN
          IF lat1 IS NULL OR lng1 IS NULL OR lat2 IS NULL OR lng2 IS NULL THEN
              RETURN NULL;
          END IF;

          dlat := radians(lat2 - lat1);
          dlng := radians(lng2 - lng1);

          a := sin(dlat / 2.0)^2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2.0)^2;
          c := 2.0 * asin(sqrt(a));

          RETURN r * c;
      END;
      $$;


--
-- Name: calcular_total_servicio(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calcular_total_servicio() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        NEW.service_base_amount_snapshot := COALESCE(
          NEW.service_base_amount_snapshot,
          NEW.duracion_pactada_horas * NEW.precio_base_hora_pactado
        );
        NEW.total_base := NEW.duracion_pactada_horas * NEW.precio_base_hora_pactado;
        NEW.total_final := NEW.total_base + COALESCE(NEW.total_extras, 0)
          + COALESCE(NEW.total_transporte, 0);
        RETURN NEW;
      END;
      $$;


--
-- Name: recalcular_metricas_empleada(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recalcular_metricas_empleada(p_empleada_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
      BEGIN
        IF p_empleada_id IS NULL THEN RETURN; END IF;
        UPDATE empleadas e
        SET total_servicios_valorados = metrics.total,
            promedio_calificacion = metrics.average
        FROM (
          SELECT COUNT(*)::integer AS total,
                 AVG(stars)::numeric(3,2) AS average
          FROM interaction_ratings
          WHERE employee_id = p_empleada_id
            AND direction = 'client_to_employee'
        ) metrics
        WHERE e.id = p_empleada_id;
      END;
      $$;




--
-- Name: alertas_clientes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alertas_clientes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cliente_id uuid NOT NULL,
    servicio_id uuid,
    mensaje_original text NOT NULL,
    emocion_detectada character varying(50) NOT NULL,
    score_sentimiento numeric(4,3) NOT NULL,
    atendida boolean DEFAULT false NOT NULL,
    atendida_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    atendida_por uuid
);


--
-- Name: apartments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.apartments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    nombre character varying(255) NOT NULL,
    direccion text,
    descripcion text,
    ubicacion_lat numeric(10,7),
    ubicacion_lng numeric(10,7),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: auth_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    family_id uuid NOT NULL,
    device_id character varying(128) NOT NULL,
    refresh_token_hash character(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    replaced_by_session_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: authorized_bank_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.authorized_bank_accounts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    banco character varying(100) NOT NULL,
    titular character varying(255) NOT NULL,
    cuenta character varying(50),
    ultimos4 character varying(4),
    clabe character varying(18),
    alias character varying(100),
    activa boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: candidate_screening_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidate_screening_answers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    screening_id uuid NOT NULL,
    question_id uuid NOT NULL,
    question_text text NOT NULL,
    answer_text text NOT NULL,
    answered_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: candidate_screenings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidate_screenings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    candidate_name character varying(255) NOT NULL,
    candidate_phone character varying(30),
    token character varying(64) NOT NULL,
    status character varying(20) DEFAULT 'pendiente'::character varying NOT NULL,
    question_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    promoted_employee_id uuid
);


--
-- Name: challenge_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.challenge_participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    challenge_id uuid NOT NULL,
    participant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(160) NOT NULL,
    participant_type character varying(20) NOT NULL,
    metric character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'scheduled'::character varying NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    created_by_user_id uuid NOT NULL,
    winner_participant_id uuid,
    winner_value numeric,
    finished_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: choferes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.choferes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    usuario_id uuid NOT NULL,
    nombre character varying(255) NOT NULL,
    telefono character varying(30) NOT NULL,
    disponible boolean DEFAULT false NOT NULL,
    ubicacion_lat numeric(10,7),
    ubicacion_lng numeric(10,7),
    ultima_ubicacion_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    vehiculo_marca character varying(255),
    vehiculo_modelo character varying(255),
    vehiculo_color character varying(255),
    vehiculo_placa character varying(50),
    rechazos_consecutivos integer DEFAULT 0 NOT NULL,
    ultimo_rechazo_at timestamp with time zone
);


--
-- Name: client_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cliente_id uuid NOT NULL,
    tier_id uuid NOT NULL,
    status public.client_memberships_status_enum DEFAULT 'active'::public.client_memberships_status_enum NOT NULL,
    assignment_type public.client_memberships_assignment_type_enum DEFAULT 'automatic'::public.client_memberships_assignment_type_enum NOT NULL,
    points_balance integer DEFAULT 0 NOT NULL,
    lifetime_points integer DEFAULT 0 NOT NULL,
    lifetime_spend numeric(12,2) DEFAULT 0 NOT NULL,
    assigned_by_user_id uuid,
    assignment_notes text,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: clientes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clientes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    primer_contacto_at timestamp with time zone DEFAULT now() NOT NULL,
    ai_calls_today integer DEFAULT 0 NOT NULL,
    last_ai_call_at timestamp with time zone,
    usuario_id uuid,
    correo_verificado_at timestamp with time zone,
    mayor_de_edad_declarado_at timestamp with time zone,
    terminos_aceptados_at timestamp with time zone
);


--
-- Name: conduct_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conduct_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    direction public.interaction_ratings_direction_enum NOT NULL,
    reporter_type character varying(20) NOT NULL,
    reporter_id uuid NOT NULL,
    subject_type character varying(20) NOT NULL,
    subject_id uuid NOT NULL,
    service_id uuid,
    trip_id uuid,
    category public.conduct_reports_category_enum NOT NULL,
    description text NOT NULL,
    priority character varying(12) DEFAULT 'normal'::character varying NOT NULL,
    status character varying(20) DEFAULT 'nuevo'::character varying NOT NULL,
    outcome character varying(20),
    assigned_admin_id uuid,
    resolution text,
    history jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    subject_statement text,
    subject_statement_at timestamp with time zone,
    historical_service_id uuid,
    historical_trip_id uuid,
    CONSTRAINT "CHK_conduct_reports_outcome" CHECK (((((status)::text = 'cerrado'::text) AND ((outcome)::text = ANY ((ARRAY['confirmado'::character varying, 'no_sustentado'::character varying])::text[]))) OR (((status)::text <> 'cerrado'::text) AND (outcome IS NULL)))),
    CONSTRAINT "CHK_conduct_reports_people" CHECK ((((reporter_type)::text = ANY ((ARRAY['client'::character varying, 'employee'::character varying, 'driver'::character varying])::text[])) AND ((subject_type)::text = ANY ((ARRAY['client'::character varying, 'employee'::character varying, 'driver'::character varying])::text[])) AND ((reporter_type)::text <> (subject_type)::text))),
    CONSTRAINT "CHK_conduct_reports_priority" CHECK (((priority)::text = ANY ((ARRAY['normal'::character varying, 'alta'::character varying, 'urgente'::character varying])::text[]))),
    CONSTRAINT "CHK_conduct_reports_status" CHECK (((status)::text = ANY ((ARRAY['nuevo'::character varying, 'en_revision'::character varying, 'cerrado'::character varying])::text[])))
);


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    booking_session_id uuid,
    service_id uuid,
    status public.conversations_status_enum DEFAULT 'activa'::public.conversations_status_enum NOT NULL,
    mode public.conversations_mode_enum DEFAULT 'AI_ACTIVE'::public.conversations_mode_enum NOT NULL,
    human_owner_id uuid,
    human_taken_at timestamp with time zone,
    state jsonb DEFAULT '{}'::jsonb NOT NULL,
    state_version integer DEFAULT 0 NOT NULL,
    last_message_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_booking_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_booking_sessions (
    id uuid NOT NULL,
    client_id uuid NOT NULL,
    intended_employee_id uuid,
    owner_boss_id uuid,
    status character varying(32) DEFAULT 'COLLECTING'::character varying NOT NULL,
    duration_hours numeric,
    open_ended_duration boolean DEFAULT false NOT NULL,
    place_type character varying(24),
    preset_location_id uuid,
    location_name character varying(160),
    location_address text,
    location_notes text,
    location_lat double precision,
    location_lng double precision,
    room character varying(80),
    payment_method character varying(24),
    schedule_type character varying(24) DEFAULT 'inmediato'::character varying NOT NULL,
    scheduled_at timestamp with time zone,
    current_requirement character varying(48),
    mode character varying(16) DEFAULT 'AI_ACTIVE'::character varying NOT NULL,
    service_id uuid,
    version integer DEFAULT 1 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_interaction_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    manual_location_confirmed boolean DEFAULT false NOT NULL
);


--
-- Name: disciplinary_sanctions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.disciplinary_sanctions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_type character varying(20) NOT NULL,
    subject_id uuid NOT NULL,
    type character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    reason text NOT NULL,
    conduct_report_id uuid,
    created_by_user_id uuid NOT NULL,
    starts_at timestamp with time zone DEFAULT now() NOT NULL,
    ends_at timestamp with time zone,
    revoked_by_user_id uuid,
    revoked_at timestamp with time zone,
    revocation_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    fine_amount numeric(12,2) DEFAULT 0,
    CONSTRAINT "CHK_disciplinary_sanctions_dates" CHECK (((((type)::text = 'suspension'::text) AND (ends_at IS NOT NULL) AND (ends_at > starts_at)) OR (((type)::text = 'permanent_ban'::text) AND (ends_at IS NULL)) OR (((type)::text = 'fine'::text) AND ((fine_amount IS NOT NULL) AND (fine_amount > (0)::numeric))))),
    CONSTRAINT "CHK_disciplinary_sanctions_status" CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'revoked'::character varying, 'expired'::character varying])::text[]))),
    CONSTRAINT "CHK_disciplinary_sanctions_subject" CHECK (((subject_type)::text = ANY ((ARRAY['client'::character varying, 'employee'::character varying, 'driver'::character varying, 'boss'::character varying])::text[]))),
    CONSTRAINT "CHK_disciplinary_sanctions_type" CHECK (((type)::text = ANY ((ARRAY['suspension'::character varying, 'permanent_ban'::character varying, 'fine'::character varying])::text[])))
);


--
-- Name: driver_settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.driver_settlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_id uuid NOT NULL,
    week_start date NOT NULL,
    week_end date NOT NULL,
    total numeric(12,2) DEFAULT 0 NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    paid_at timestamp with time zone,
    paid_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT driver_settlements_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'paid'::character varying])::text[])))
);


--
-- Name: driver_shift_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.driver_shift_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shift_id uuid NOT NULL,
    driver_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: driver_shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.driver_shifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(120) NOT NULL,
    starts_at character varying(5) NOT NULL,
    ends_at character varying(5) NOT NULL,
    days_of_week smallint[] NOT NULL,
    capacity integer,
    active boolean DEFAULT true NOT NULL,
    created_by_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: empleada_fotos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.empleada_fotos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    empleada_id uuid NOT NULL,
    url text NOT NULL,
    orden smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: empleada_fotos_exclusivas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.empleada_fotos_exclusivas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    empleada_id uuid NOT NULL,
    url text NOT NULL,
    orden smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: empleadas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.empleadas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    usuario_id uuid NOT NULL,
    nombre_real character varying(255) NOT NULL,
    nombre_artistico character varying(255) NOT NULL,
    slug_catalogo character varying(100) NOT NULL,
    foto_perfil_url text,
    descripcion text,
    link_x character varying(255),
    contact_label character varying(100),
    precio_base_hora numeric(10,2) NOT NULL,
    disponible boolean DEFAULT false NOT NULL,
    catalogo_activo boolean DEFAULT true NOT NULL,
    ubicacion_lat numeric(10,7),
    ubicacion_lng numeric(10,7),
    ultima_ubicacion_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    apartment_id uuid,
    jefe_id uuid,
    jefe_secundario_id uuid,
    total_servicios_valorados integer DEFAULT 0 NOT NULL,
    promedio_calificacion numeric(3,2),
    estilo_habla text,
    politica_besos character varying(20),
    CONSTRAINT "CHK_empleadas_politica_besos" CHECK (((politica_besos IS NULL) OR ((politica_besos)::text = ANY ((ARRAY['no_besa'::character varying, 'besos'::character varying, 'besos_bien_dados'::character varying])::text[]))))
);


--
-- Name: employee_cash_obligations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_cash_obligations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid,
    employee_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    paid_amount numeric(12,2) DEFAULT 0 NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    calculation_status character varying(20) DEFAULT 'provisional'::character varying NOT NULL,
    pending_reason character varying(240),
    customer_total numeric(12,2) DEFAULT 0 NOT NULL,
    uber_deduction numeric(12,2) DEFAULT 0 NOT NULL,
    service_date timestamp with time zone NOT NULL,
    historical_service_id uuid,
    administratively_excluded boolean DEFAULT false NOT NULL,
    CONSTRAINT "CHK_cash_obligation_calculation_status" CHECK (((calculation_status)::text = ANY ((ARRAY['provisional'::character varying, 'ready'::character varying, 'paid'::character varying])::text[]))),
    CONSTRAINT employee_cash_obligations_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT employee_cash_obligations_paid_amount_check CHECK ((paid_amount >= (0)::numeric)),
    CONSTRAINT employee_cash_obligations_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'paid'::character varying])::text[])))
);


--
-- Name: employee_cash_payment_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_cash_payment_allocations (
    payment_id uuid NOT NULL,
    obligation_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    CONSTRAINT employee_cash_payment_allocations_amount_check CHECK ((amount > (0)::numeric))
);


--
-- Name: employee_cash_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_cash_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    note character varying(240),
    registered_by_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    origin character varying(20) DEFAULT 'physical'::character varying NOT NULL,
    reverted_at timestamp with time zone,
    reverted_by_user_id uuid,
    reverted_reason character varying(240),
    CONSTRAINT employee_cash_payments_amount_check CHECK ((amount > (0)::numeric))
);


--
-- Name: employee_onboardings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_onboardings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid,
    publication_key uuid NOT NULL,
    status public.employee_onboardings_status_enum DEFAULT 'pending'::public.employee_onboardings_status_enum NOT NULL,
    active boolean DEFAULT true NOT NULL,
    is_renewal boolean DEFAULT false NOT NULL,
    attempt_count smallint DEFAULT 0 NOT NULL,
    best_score smallint DEFAULT 0 NOT NULL,
    trust_score smallint DEFAULT 1 NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone,
    completed_at timestamp with time zone,
    last_delivery_error text,
    user_id uuid NOT NULL,
    web_reminder_count smallint DEFAULT 0 NOT NULL,
    last_web_reminder_at timestamp with time zone,
    CONSTRAINT employee_onboardings_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT employee_onboardings_best_score_check CHECK (((best_score >= 0) AND (best_score <= 100))),
    CONSTRAINT employee_onboardings_trust_score_check CHECK (((trust_score >= 1) AND (trust_score <= 5)))
);


--
-- Name: employee_rating_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_rating_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    average numeric,
    rating_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: employee_regulations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_regulations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(255) NOT NULL,
    content text NOT NULL,
    passing_score smallint DEFAULT 80 NOT NULL,
    publication_key uuid NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    target_role public.employee_regulations_target_role_enum DEFAULT 'empleada'::public.employee_regulations_target_role_enum NOT NULL,
    CONSTRAINT employee_regulations_passing_score_check CHECK (((passing_score >= 1) AND (passing_score <= 100)))
);


--
-- Name: employee_report_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_report_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_id uuid NOT NULL,
    actor_user_id uuid,
    action character varying(40) NOT NULL,
    metadata jsonb,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: employee_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid,
    employee_id uuid NOT NULL,
    boss_id uuid NOT NULL,
    origin public.employee_reports_origin_enum NOT NULL,
    client_id uuid,
    driver_id uuid,
    reporter_key character varying(80) NOT NULL,
    category public.employee_reports_category_enum NOT NULL,
    description text NOT NULL,
    priority public.employee_reports_priority_enum DEFAULT 'normal'::public.employee_reports_priority_enum NOT NULL,
    status public.employee_reports_status_enum DEFAULT 'nuevo'::public.employee_reports_status_enum NOT NULL,
    assigned_admin_id uuid,
    resolution text,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    historical_service_id uuid,
    CONSTRAINT "CHK_employee_reports_author" CHECK ((((origin = 'cliente'::public.employee_reports_origin_enum) AND (client_id IS NOT NULL) AND (driver_id IS NULL)) OR ((origin = 'chofer'::public.employee_reports_origin_enum) AND (driver_id IS NOT NULL) AND (client_id IS NULL))))
);


--
-- Name: employee_weekly_settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_weekly_settlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    week_start date NOT NULL,
    week_end date NOT NULL,
    gross_employee_pay numeric(12,2) NOT NULL,
    cash_offset numeric(12,2) NOT NULL,
    net_employee_pay numeric(12,2) NOT NULL,
    remaining_cash_debt numeric(12,2) NOT NULL,
    confirmed_by_user_id uuid NOT NULL,
    confirmed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: extensiones_servicio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.extensiones_servicio (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    servicio_id uuid NOT NULL,
    horas_agregadas numeric(4,2) NOT NULL,
    monto_agregado numeric(10,2) NOT NULL,
    aceptada_por public.extensiones_servicio_aceptada_por_enum NOT NULL,
    registrada_at timestamp with time zone DEFAULT now() NOT NULL,
    employee_percentage_snapshot numeric(5,2) DEFAULT 60 NOT NULL,
    employee_expected_snapshot numeric(12,2) NOT NULL,
    financial_snapshot_status character varying(24) DEFAULT 'captured'::character varying NOT NULL
);


--
-- Name: extras_catalogo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.extras_catalogo (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    empleada_id uuid NOT NULL,
    nombre character varying(150) NOT NULL,
    precio numeric(10,2) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    modelos_vinculadas_ids jsonb DEFAULT '[]'::jsonb,
    speech_personalizado text,
    es_generico boolean DEFAULT false NOT NULL
);


--
-- Name: extras_servicio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.extras_servicio (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    servicio_id uuid NOT NULL,
    extra_catalogo_id uuid NOT NULL,
    precio_cobrado numeric(10,2) NOT NULL,
    metodo_pago public.extras_servicio_metodo_pago_enum NOT NULL,
    registrado_at timestamp with time zone DEFAULT now() NOT NULL,
    registrado_por uuid,
    participant_id uuid,
    company_percentage_snapshot numeric(5,2) DEFAULT 0 NOT NULL,
    commission_threshold_snapshot numeric(12,2),
    company_commission_snapshot numeric(12,2) DEFAULT 0 NOT NULL,
    employee_net_snapshot numeric(12,2) NOT NULL,
    financial_snapshot_status character varying(24) DEFAULT 'captured'::character varying NOT NULL
);


--
-- Name: group_service_request_selections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_service_request_selections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    status character varying(20) DEFAULT 'reservada'::character varying NOT NULL,
    selected_by character varying(20) NOT NULL,
    hourly_rate_snapshot numeric(10,2) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "CHK_group_selection_actor" CHECK (((selected_by)::text = ANY ((ARRAY['cliente'::character varying, 'jefe'::character varying])::text[]))),
    CONSTRAINT "CHK_group_selection_status" CHECK (((status)::text = ANY ((ARRAY['seleccionada'::character varying, 'reservada'::character varying, 'liberada'::character varying, 'confirmada'::character varying])::text[])))
);


--
-- Name: group_service_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_service_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    boss_id uuid NOT NULL,
    initial_employee_id uuid,
    service_id uuid,
    booking_session_id uuid,
    status character varying(30) DEFAULT 'esperando_jefe'::character varying NOT NULL,
    duration_hours numeric(4,2),
    payment_method character varying(20),
    location_lat numeric(10,7),
    location_lng numeric(10,7),
    location_reference character varying(240),
    catalog_version integer DEFAULT 0 NOT NULL,
    hold_expires_at timestamp with time zone,
    ai_active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    conversation_id uuid,
    CONSTRAINT "CHK_group_request_payment" CHECK (((payment_method IS NULL) OR ((payment_method)::text = ANY ((ARRAY['efectivo'::character varying, 'tarjeta'::character varying, 'transferencia'::character varying, 'mixto'::character varying])::text[])))),
    CONSTRAINT "CHK_group_request_status" CHECK (((status)::text = ANY ((ARRAY['esperando_jefe'::character varying, 'seleccionando'::character varying, 'reservada'::character varying, 'esperando_pago'::character varying, 'confirmada'::character varying, 'vencida'::character varying, 'cancelada'::character varying])::text[])))
);


--
-- Name: interaction_ratings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interaction_ratings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    direction public.interaction_ratings_direction_enum NOT NULL,
    service_id uuid,
    trip_id uuid,
    client_id uuid,
    employee_id uuid,
    driver_id uuid,
    stars smallint NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    appeal_status character varying(20) DEFAULT 'none'::character varying NOT NULL,
    appeal_reason text,
    appeal_resolved_at timestamp with time zone,
    appeal_resolved_by_user_id uuid,
    historical_service_id uuid,
    historical_trip_id uuid,
    CONSTRAINT "CHK_interaction_ratings_reference" CHECK (((((service_id IS NOT NULL) OR (historical_service_id IS NOT NULL)) AND ((trip_id IS NULL) AND (historical_trip_id IS NULL)) AND (direction = ANY (ARRAY['client_to_employee'::public.interaction_ratings_direction_enum, 'employee_to_client'::public.interaction_ratings_direction_enum]))) OR (((service_id IS NOT NULL) OR (historical_service_id IS NOT NULL)) AND ((trip_id IS NOT NULL) OR (historical_trip_id IS NOT NULL)) AND (direction = ANY (ARRAY['driver_to_employee'::public.interaction_ratings_direction_enum, 'employee_to_driver'::public.interaction_ratings_direction_enum]))))),
    CONSTRAINT "CHK_interaction_ratings_stars" CHECK (((stars >= 1) AND (stars <= 5)))
);


--
-- Name: liquidation_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.liquidation_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type character varying(30) NOT NULL,
    entity_id uuid NOT NULL,
    action character varying(30) NOT NULL,
    actor_user_id uuid NOT NULL,
    before_value jsonb,
    after_value jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: liquidation_debts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.liquidation_debts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    description character varying(300) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    created_by_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT "CHK_liquidation_debt_amount" CHECK ((amount > (0)::numeric)),
    CONSTRAINT "CHK_liquidation_debt_status" CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'paid'::character varying])::text[])))
);


--
-- Name: liquidation_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.liquidation_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    debt_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    note character varying(300),
    created_by_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT "CHK_liquidation_payment_amount" CHECK ((amount > (0)::numeric))
);


--
-- Name: liquidation_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.liquidation_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    registered_by_user_id uuid NOT NULL,
    source_role character varying(20) NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    service_total numeric(12,2) NOT NULL,
    payment_method character varying(20) NOT NULL,
    cash_amount numeric(12,2) DEFAULT 0 NOT NULL,
    card_amounts jsonb DEFAULT '[]'::jsonb NOT NULL,
    company_percentage numeric(5,2) DEFAULT 40 NOT NULL,
    extra_amount numeric(12,2) DEFAULT 0 NOT NULL,
    promotion boolean DEFAULT false NOT NULL,
    membership_amount numeric(12,2) DEFAULT 0 NOT NULL,
    company_transport_expense numeric(12,2) DEFAULT 0 NOT NULL,
    transport_excess numeric(12,2) DEFAULT 0 NOT NULL,
    place character varying(120),
    has_outbound_driver boolean DEFAULT false NOT NULL,
    has_return_driver boolean DEFAULT false NOT NULL,
    cancelled boolean DEFAULT false NOT NULL,
    is_fine boolean DEFAULT false NOT NULL,
    fine_amount numeric(12,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    service_id uuid,
    customer_transport_charge numeric(12,2) DEFAULT 0 NOT NULL,
    employee_uber_reimbursement numeric(12,2) DEFAULT 0 NOT NULL,
    employee_cash_due numeric(12,2) DEFAULT 0 NOT NULL,
    electronic_extra_amount numeric(12,2) DEFAULT 0 NOT NULL,
    card_extra_amount numeric(12,2) DEFAULT 0 NOT NULL,
    card_extra_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    excluded_from_cut boolean DEFAULT false NOT NULL,
    historical_service_id uuid,
    CONSTRAINT "CHK_liquidation_payment_method" CHECK (((payment_method)::text = ANY ((ARRAY['efectivo'::character varying, 'tarjeta'::character varying, 'transferencia'::character varying, 'mixto'::character varying, 'membresia'::character varying])::text[]))),
    CONSTRAINT "CHK_liquidation_source_role" CHECK (((source_role)::text = ANY ((ARRAY['admin'::character varying, 'jefe'::character varying, 'empleada'::character varying])::text[])))
);


--
-- Name: liquidation_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.liquidation_settings (
    id smallint DEFAULT 1 NOT NULL,
    card_extra_commission_percentage numeric(5,2) DEFAULT 15 NOT NULL,
    card_extra_commission_threshold numeric(12,2) DEFAULT 1000 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_user_id uuid,
    weekly_content_fine_amount numeric(12,2) DEFAULT 300 NOT NULL,
    weekly_content_max_reminders smallint DEFAULT 3 NOT NULL,
    CONSTRAINT liquidation_settings_card_extra_commission_percentage_check CHECK (((card_extra_commission_percentage >= (0)::numeric) AND (card_extra_commission_percentage <= (100)::numeric))),
    CONSTRAINT liquidation_settings_card_extra_commission_threshold_check CHECK ((card_extra_commission_threshold >= (0)::numeric)),
    CONSTRAINT liquidation_settings_id_check CHECK ((id = 1)),
    CONSTRAINT liquidation_settings_weekly_content_fine_amount_check CHECK ((weekly_content_fine_amount >= (0)::numeric)),
    CONSTRAINT liquidation_settings_weekly_content_max_reminders_check CHECK (((weekly_content_max_reminders >= 1) AND (weekly_content_max_reminders <= 10)))
);


--
-- Name: loyalty_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_tiers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(120) NOT NULL,
    min_spend numeric(12,2) DEFAULT 0 NOT NULL,
    earn_rate numeric(10,4) DEFAULT 0.1000 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: loyalty_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cliente_id uuid NOT NULL,
    servicio_id uuid,
    created_by_user_id uuid,
    type public.loyalty_transactions_type_enum NOT NULL,
    points integer NOT NULL,
    amount_basis numeric(12,2),
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mensajes_equipo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mensajes_equipo (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    empleada_id uuid NOT NULL,
    emisor character varying(10) NOT NULL,
    autor_user_id uuid,
    cuerpo text NOT NULL,
    tipo character varying(20) DEFAULT 'duda'::character varying NOT NULL,
    leido_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mensajes_equipo_emisor_check CHECK (((emisor)::text = ANY ((ARRAY['empleada'::character varying, 'jefe'::character varying])::text[])))
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    sender public.messages_sender_enum NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    attachment jsonb,
    receipt_validation_id uuid,
    client_message_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: migrations; Type: TABLE; Schema: public; Owner: -
--



--
-- Name: migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--



--
-- Name: migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--



--
-- Name: payment_receipt_validations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_receipt_validations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    fecha_recepcion date,
    hora_recepcion character varying(10),
    cliente_nombre character varying(255),
    es_comprobante boolean DEFAULT false NOT NULL,
    banco_origen character varying(100),
    banco_destino character varying(100),
    titular_destino character varying(255),
    cuenta_destino character varying(50),
    clabe character varying(18),
    monto numeric(10,2),
    fecha_transferencia character varying(50),
    hora_transferencia character varying(20),
    referencia character varying(50),
    folio character varying(50),
    id_spei character varying(100),
    concepto character varying(255),
    confianza integer,
    estado character varying(50),
    observaciones text,
    json_ia jsonb,
    servicio_id uuid,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    image_url text,
    jefe_id uuid,
    revisado_por_user_id uuid,
    revisado_at timestamp with time zone,
    draft_payload jsonb,
    monto_esperado numeric(10,2),
    tipo_cobro character varying(20),
    pago_confirmado_at timestamp with time zone,
    pago_confirmado_por_user_id uuid,
    pago_confirmacion_fuente character varying(20)
);


--
-- Name: post_likes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_likes (
    post_id uuid NOT NULL,
    client_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: post_media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_media (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    kind public.post_media_kind_enum NOT NULL,
    url text NOT NULL,
    poster_url text,
    mime_type text NOT NULL,
    bytes integer NOT NULL,
    width integer,
    height integer,
    duration_ms integer,
    "position" smallint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_post_media_poster_only_video CHECK (((kind = 'video'::public.post_media_kind_enum) OR (poster_url IS NULL)))
);


--
-- Name: posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    author_user_id uuid,
    author_role text NOT NULL,
    caption text DEFAULT ''::text NOT NULL,
    status public.posts_status_enum DEFAULT 'borrador'::public.posts_status_enum NOT NULL,
    submitted_at timestamp with time zone,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    rejection_reason text,
    published_at timestamp with time zone,
    archived_at timestamp with time zone,
    like_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_posts_approved_review CHECK (((status <> 'aprobado'::public.posts_status_enum) OR (published_at IS NOT NULL))),
    CONSTRAINT ck_posts_author_role CHECK ((author_role = ANY (ARRAY['empleada'::text, 'jefe'::text, 'admin'::text]))),
    CONSTRAINT ck_posts_caption_length CHECK ((char_length(caption) <= 2000)),
    CONSTRAINT ck_posts_like_count CHECK ((like_count >= 0)),
    CONSTRAINT ck_posts_rejection_reason CHECK (((status <> 'rechazado'::public.posts_status_enum) OR (rejection_reason IS NOT NULL)))
);


--
-- Name: preset_service_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.preset_service_locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(80) NOT NULL,
    address character varying(240) NOT NULL,
    latitude numeric(10,7) NOT NULL,
    longitude numeric(10,7) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: prorrogas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prorrogas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    servicio_id uuid NOT NULL,
    numero_prorroga smallint NOT NULL,
    minutos_solicitados smallint NOT NULL,
    solicitada_at timestamp with time zone DEFAULT now() NOT NULL,
    aprobada boolean DEFAULT true NOT NULL
);


--
-- Name: push_notification_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_notification_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    usuario_id uuid NOT NULL,
    type character varying(100) NOT NULL,
    related_entity_id uuid,
    dedupe_key character varying(300) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    delivered_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT ck_push_notification_events_status CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'sent'::character varying, 'failed'::character varying, 'skipped'::character varying])::text[])))
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    usuario_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    creada_en timestamp with time zone DEFAULT now() NOT NULL,
    ultimo_envio timestamp with time zone,
    fallos smallint DEFAULT 0 NOT NULL,
    actualizada_en timestamp with time zone DEFAULT now() NOT NULL,
    ultima_vista_en timestamp with time zone DEFAULT now() NOT NULL,
    habilitada boolean DEFAULT true NOT NULL,
    ultimo_fallo_en timestamp with time zone
);


--
-- Name: questionnaire_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.questionnaire_answers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    attempt_id uuid NOT NULL,
    question_id uuid NOT NULL,
    option_id uuid NOT NULL,
    is_correct boolean NOT NULL,
    answered_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: questionnaire_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.questionnaire_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    onboarding_id uuid NOT NULL,
    attempt_number smallint NOT NULL,
    status public.questionnaire_attempts_status_enum DEFAULT 'in_progress'::public.questionnaire_attempts_status_enum NOT NULL,
    correct_answers smallint DEFAULT 0 NOT NULL,
    total_questions smallint DEFAULT 0 NOT NULL,
    score smallint DEFAULT 0 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT questionnaire_attempts_score_check CHECK (((score >= 0) AND (score <= 100)))
);


--
-- Name: realtime_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.realtime_outbox (
    id bigint NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: realtime_outbox_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.realtime_outbox_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: realtime_outbox_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.realtime_outbox_id_seq OWNED BY public.realtime_outbox.id;


--
-- Name: regulation_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.regulation_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    question_id uuid NOT NULL,
    text text NOT NULL,
    is_correct boolean DEFAULT false NOT NULL,
    display_order smallint NOT NULL
);


--
-- Name: regulation_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.regulation_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    regulation_id uuid NOT NULL,
    publication_key uuid NOT NULL,
    text text NOT NULL,
    display_order smallint NOT NULL,
    group_key character varying(60)
);


--
-- Name: screening_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.screening_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    text text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    display_order smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    options jsonb DEFAULT '[]'::jsonb
);


--
-- Name: service_admin_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_admin_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid NOT NULL,
    action character varying(40) NOT NULL,
    actor_id uuid NOT NULL,
    actor_role character varying(20) NOT NULL,
    reason text NOT NULL,
    previous_state character varying(40),
    previous_operational_state character varying(60),
    financial_snapshot jsonb NOT NULL,
    affected_dependencies jsonb NOT NULL,
    result jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: service_group_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_group_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid,
    request_id uuid,
    actor_user_id uuid,
    action character varying(40) NOT NULL,
    before jsonb,
    after jsonb,
    reason character varying(300),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "CHK_group_audit_target" CHECK (((service_id IS NOT NULL) OR (request_id IS NOT NULL)))
);


--
-- Name: service_operation_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_operation_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid NOT NULL,
    type character varying(80) NOT NULL,
    from_state character varying(50),
    to_state character varying(50),
    actor_user_id uuid,
    actor_type character varying(30) DEFAULT 'system'::character varying NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_operation_events_actor_type_check CHECK (((actor_type)::text = ANY ((ARRAY['system'::character varying, 'jefe'::character varying, 'empleada'::character varying, 'chofer'::character varying, 'admin'::character varying])::text[])))
);


--
-- Name: service_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    role character varying(20) DEFAULT 'participante'::character varying NOT NULL,
    status character varying(20) DEFAULT 'reservada'::character varying NOT NULL,
    hourly_rate_snapshot numeric(10,2) NOT NULL,
    billable_hours numeric(4,2) NOT NULL,
    confirmed_subtotal numeric(12,2) NOT NULL,
    hold_expires_at timestamp with time zone,
    joined_at timestamp with time zone,
    removed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "CHK_service_participant_amounts" CHECK (((hourly_rate_snapshot >= (0)::numeric) AND (billable_hours >= (0)::numeric) AND (confirmed_subtotal >= (0)::numeric))),
    CONSTRAINT "CHK_service_participant_role" CHECK (((role)::text = ANY ((ARRAY['responsable'::character varying, 'participante'::character varying])::text[]))),
    CONSTRAINT "CHK_service_participant_status" CHECK (((status)::text = ANY ((ARRAY['reservada'::character varying, 'pendiente_pago'::character varying, 'activa'::character varying, 'retirada'::character varying, 'cancelada'::character varying])::text[])))
);


--
-- Name: service_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid NOT NULL,
    receipt_validation_id uuid,
    approved_by_user_id uuid,
    amount numeric(12,2) NOT NULL,
    status character varying(20) DEFAULT 'pendiente'::character varying NOT NULL,
    fingerprint character varying(180),
    notes character varying(300),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_payments_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT service_payments_status_check CHECK (((status)::text = ANY ((ARRAY['pendiente'::character varying, 'aprobado'::character varying, 'rechazado'::character varying])::text[])))
);


--
-- Name: servicios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.servicios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    empleada_id uuid NOT NULL,
    cliente_id uuid,
    jefe_id uuid NOT NULL,
    metodo_pago public.servicios_metodo_pago_enum NOT NULL,
    duracion_pactada_horas numeric(4,2) NOT NULL,
    duracion_final_horas numeric(4,2),
    ubicacion_cliente_lat numeric(10,7),
    ubicacion_cliente_lng numeric(10,7),
    precio_base_hora_pactado numeric(10,2) NOT NULL,
    total_base numeric(10,2) DEFAULT 0 NOT NULL,
    total_extras numeric(10,2) DEFAULT 0 NOT NULL,
    total_final numeric(10,2) DEFAULT 0 NOT NULL,
    hora_inicio_servicio timestamp with time zone,
    hora_fin_servicio timestamp with time zone,
    hora_llegada_casa timestamp with time zone,
    prorrogas_usadas smallint DEFAULT 0 NOT NULL,
    estado public.servicios_estado_enum DEFAULT 'pendiente'::public.servicios_estado_enum NOT NULL,
    notas text,
    ia_activa boolean DEFAULT true NOT NULL,
    calificacion integer,
    comentarios_calificacion text,
    notificacion_extension_enviada boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    total_transporte numeric(10,2) DEFAULT 0 NOT NULL,
    estado_liquidacion character varying(30) DEFAULT 'cerrada'::character varying NOT NULL,
    recordatorios_regreso smallint DEFAULT 0 NOT NULL,
    proximo_recordatorio_regreso_at timestamp with time zone,
    preset_location_id uuid,
    location_name_snapshot character varying(80),
    location_address_snapshot character varying(240),
    customer_transport_charge numeric(10,2),
    actual_transport_cost numeric(10,2) DEFAULT 0 NOT NULL,
    servicio_previo_id uuid,
    hora_disponibilidad_estimada timestamp with time zone,
    hora_inicio_estimada timestamp with time zone,
    notas_jefe text,
    transporte_agendado character varying(10),
    comprobante_pago_file_id character varying(255),
    service_type character varying(20) DEFAULT 'individual'::character varying NOT NULL,
    total_paid numeric(12,2) DEFAULT 0 NOT NULL,
    pending_balance numeric(12,2) DEFAULT 0 NOT NULL,
    transport_fee_snapshot numeric(10,2) DEFAULT 0 NOT NULL,
    manual_transport_adjustment numeric(10,2) DEFAULT 0 NOT NULL,
    pending_duration_hours numeric(4,2),
    fecha_programada timestamp with time zone,
    tipo_agenda character varying(20) DEFAULT 'inmediato'::character varying NOT NULL,
    notificacion_previa_enviada boolean DEFAULT false NOT NULL,
    duracion_indefinida boolean DEFAULT false NOT NULL,
    cobro_final_pendiente boolean DEFAULT false NOT NULL,
    motivo_cancelacion character varying(40),
    nota_cancelacion text,
    cancelado_por_user_id uuid,
    cancelado_at timestamp with time zone,
    espera_expira_at timestamp with time zone,
    registro_manual boolean DEFAULT false NOT NULL,
    cliente_nombre_libre character varying(255),
    habitacion character varying(50),
    cerrado_por_oficina_user_id uuid,
    cerrado_por_oficina_at timestamp with time zone,
    motivo_cierre_oficina text,
    empleada_anterior_id uuid,
    reasignado_por_user_id uuid,
    reasignado_at timestamp with time zone,
    motivo_reasignacion text,
    comprobante_pendiente boolean DEFAULT false NOT NULL,
    empleada_lista_at timestamp with time zone,
    estado_operativo character varying(50) DEFAULT 'preparacion'::character varying NOT NULL,
    aceptacion_empleada_expira_at timestamp with time zone,
    aceptacion_empleada_recordada_at timestamp with time zone,
    aceptacion_empleada_at timestamp with time zone,
    aceptacion_empleada_escalada_at timestamp with time zone,
    aviso_fin_proximo_at timestamp with time zone,
    booking_session_id uuid,
    service_base_amount_snapshot numeric(12,2) NOT NULL,
    employee_percentage_snapshot numeric(5,2) DEFAULT 60 NOT NULL,
    financial_snapshot_status character varying(24) DEFAULT 'captured'::character varying NOT NULL,
    administrative_void_at timestamp with time zone,
    administrative_void_by_user_id uuid,
    administrative_void_reason text,
    administrative_review_required boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by_user_id uuid,
    delete_reason text,
    previous_status character varying(30),
    previous_operational_state character varying(60),
    CONSTRAINT "CHK_servicios_calificacion" CHECK (((calificacion IS NULL) OR ((calificacion >= 1) AND (calificacion <= 5)))),
    CONSTRAINT "CHK_servicios_estado_liquidacion" CHECK (((estado_liquidacion)::text = ANY ((ARRAY['transporte_pendiente'::character varying, 'cerrada'::character varying])::text[]))),
    CONSTRAINT "CHK_servicios_motivo_cancelacion" CHECK (((motivo_cancelacion IS NULL) OR ((motivo_cancelacion)::text = ANY ((ARRAY['cliente_desistio'::character varying, 'cliente_no_responde'::character varying, 'modelo_no_disponible'::character varying, 'modelo_tardanza'::character varying, 'sin_transporte'::character varying, 'problema_pago'::character varying, 'seguridad'::character varying, 'error_operativo'::character varying, 'rechazado_por_jefe'::character varying, 'otro'::character varying])::text[])))),
    CONSTRAINT "CHK_servicios_service_type" CHECK (((service_type)::text = ANY ((ARRAY['individual'::character varying, 'grupal'::character varying])::text[]))),
    CONSTRAINT chk_servicios_estado_operativo CHECK (((estado_operativo)::text = ANY ((ARRAY['preparacion'::character varying, 'preparado'::character varying, 'asignado'::character varying, 'esperando_aceptacion_empleada'::character varying, 'aceptado'::character varying, 'esperando_transporte_ida'::character varying, 'transporte_ida_asignado'::character varying, 'empleada_en_camino'::character varying, 'empleada_llego'::character varying, 'en_curso'::character varying, 'preparando_regreso'::character varying, 'transporte_regreso_asignado'::character varying, 'empleada_de_regreso'::character varying, 'finalizado'::character varying, 'rechazado'::character varying, 'cancelado'::character varying, 'expirado'::character varying])::text[])))
);


--
-- Name: solicitudes_servicio_manual; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solicitudes_servicio_manual (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    empleada_id uuid NOT NULL,
    jefe_id uuid NOT NULL,
    cliente_id uuid,
    cliente_nombre_libre character varying(255),
    fecha_servicio timestamp with time zone NOT NULL,
    duracion_horas numeric(4,2) NOT NULL,
    metodo_pago character varying(20) NOT NULL,
    monto_cobrado numeric(10,2) NOT NULL,
    ubicacion character varying(255),
    motivo text NOT NULL,
    estado character varying(20) DEFAULT 'pendiente'::character varying NOT NULL,
    servicio_id uuid,
    nota_resolucion text,
    resuelto_por_user_id uuid,
    resuelto_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tipo character varying(20) DEFAULT 'pasado'::character varying NOT NULL
);


--
-- Name: transport_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transport_settings (
    id smallint DEFAULT 1 NOT NULL,
    external_location_fee numeric(10,2) DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_user_id uuid,
    coverage_city character varying(80) DEFAULT 'Querétaro'::character varying NOT NULL,
    coverage_center_lat numeric(10,7) DEFAULT 20.5888 NOT NULL,
    coverage_center_lng numeric(10,7) DEFAULT '-100.3899'::numeric NOT NULL,
    coverage_radius_km numeric(6,2) DEFAULT 45 NOT NULL,
    CONSTRAINT chk_transport_settings_coverage_radius CHECK (((coverage_radius_km > (0)::numeric) AND (coverage_radius_km <= (500)::numeric))),
    CONSTRAINT transport_settings_external_location_fee_check CHECK ((external_location_fee >= (0)::numeric)),
    CONSTRAINT transport_settings_id_check CHECK ((id = 1))
);


--
-- Name: trip_passengers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trip_passengers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trip_id uuid NOT NULL,
    employee_id uuid NOT NULL
);


--
-- Name: user_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_preferences (
    user_id uuid NOT NULL,
    key character varying(60) NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usuarios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    password_hash text NOT NULL,
    rol public.usuarios_rol_enum NOT NULL,
    nombre character varying(255),
    apellido character varying(255),
    activo boolean DEFAULT true NOT NULL,
    telefono character varying(50),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_login_at timestamp with time zone,
    disponible boolean DEFAULT true NOT NULL,
    en_jornada boolean DEFAULT true NOT NULL,
    jornada_actualizada_at timestamp with time zone,
    jornada_motivo text,
    jornada_motivo_at timestamp with time zone,
    debe_cambiar_password boolean DEFAULT false NOT NULL
);


--
-- Name: verificaciones_correo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verificaciones_correo (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    usuario_id uuid NOT NULL,
    token_hash character(64) NOT NULL,
    expira_at timestamp with time zone NOT NULL,
    usado_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: viajes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.viajes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    servicio_id uuid NOT NULL,
    chofer_id uuid,
    tipo public.viajes_tipo_enum NOT NULL,
    zona public.viajes_zona_enum NOT NULL,
    tarifa numeric(10,2) NOT NULL,
    estado public.viajes_estado_enum DEFAULT 'notificado'::public.viajes_estado_enum NOT NULL,
    hora_notificacion timestamp with time zone DEFAULT now() NOT NULL,
    hora_aceptacion timestamp with time zone,
    hora_inicio_viaje timestamp with time zone,
    hora_fin_viaje timestamp with time zone,
    choferes_notificados jsonb DEFAULT '[]'::jsonb NOT NULL,
    proveedor_transporte character varying(50) DEFAULT 'interno'::character varying NOT NULL,
    driver_payout numeric(10,2) DEFAULT 0 NOT NULL,
    fare_confirmed_at timestamp with time zone,
    fare_confirmed_by_user_id uuid,
    fare_confirmation_override boolean DEFAULT false NOT NULL,
    driver_settlement_id uuid,
    unit_number smallint DEFAULT 1 NOT NULL,
    uber_screenshot_url text,
    uber_screenshot_uploaded_at timestamp with time zone,
    oferta_expira_en timestamp with time zone,
    cancelado_con_costo boolean DEFAULT false NOT NULL,
    costo_cobrado_al_cliente boolean DEFAULT false NOT NULL,
    chofer_anterior_id uuid,
    corregido_por_user_id uuid,
    corregido_at timestamp with time zone,
    motivo_correccion text,
    external_platform character varying(50),
    external_shared_link text
);


--
-- Name: weekly_content_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weekly_content_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    empleada_id uuid NOT NULL,
    semana_inicio date NOT NULL,
    estado character varying(30) DEFAULT 'solicitado'::character varying NOT NULL,
    solicitado_at timestamp with time zone DEFAULT now() NOT NULL,
    recordatorio_at timestamp with time zone,
    falta_at timestamp with time zone,
    entregado_at timestamp with time zone,
    recordatorios_enviados integer DEFAULT 0 NOT NULL,
    multa_aplicada_at timestamp with time zone,
    multa_liquidation_record_id uuid
);


--
-- Name: weekly_photo_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weekly_photo_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    empleada_id uuid NOT NULL,
    url text NOT NULL,
    estado character varying(30) DEFAULT 'pendiente'::character varying NOT NULL,
    semana_inicio date,
    revisado_por_user_id uuid,
    revisado_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    motivo_rechazo text
);


--
-- Name: migrations id; Type: DEFAULT; Schema: public; Owner: -
--



--
-- Name: realtime_outbox id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.realtime_outbox ALTER COLUMN id SET DEFAULT nextval('public.realtime_outbox_id_seq'::regclass);


--
-- Name: prorrogas PK_11deb30e7378441daa8d211ab73; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prorrogas
    ADD CONSTRAINT "PK_11deb30e7378441daa8d211ab73" PRIMARY KEY (id);


--
-- Name: extensiones_servicio PK_340ae96e5def64bc193e20a09e5; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extensiones_servicio
    ADD CONSTRAINT "PK_340ae96e5def64bc193e20a09e5" PRIMARY KEY (id);


--
-- Name: viajes PK_494f8b59dff1674f6b4efbcea2a; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.viajes
    ADD CONSTRAINT "PK_494f8b59dff1674f6b4efbcea2a" PRIMARY KEY (id);


--
-- Name: alertas_clientes PK_6ff5aaf44917c6d5f25bc4088b9; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alertas_clientes
    ADD CONSTRAINT "PK_6ff5aaf44917c6d5f25bc4088b9" PRIMARY KEY (id);


--
-- Name: choferes PK_7195d73953de6e5118ac0b1897f; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.choferes
    ADD CONSTRAINT "PK_7195d73953de6e5118ac0b1897f" PRIMARY KEY (id);


--
-- Name: extras_catalogo PK_78ff74b1308d31926b83ccc0fe0; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extras_catalogo
    ADD CONSTRAINT "PK_78ff74b1308d31926b83ccc0fe0" PRIMARY KEY (id);


--
-- Name: migrations PK_8c82d7f526340ab734260ea46be; Type: CONSTRAINT; Schema: public; Owner: -
--



--
-- Name: client_memberships PK_9af651aed817371e186e0c0669c; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_memberships
    ADD CONSTRAINT "PK_9af651aed817371e186e0c0669c" PRIMARY KEY (id);


--
-- Name: loyalty_tiers PK_a669fdbbbe951b211e403c977a6; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_tiers
    ADD CONSTRAINT "PK_a669fdbbbe951b211e403c977a6" PRIMARY KEY (id);


--
-- Name: empleada_fotos PK_a67e10f6dade74044877b36c056; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empleada_fotos
    ADD CONSTRAINT "PK_a67e10f6dade74044877b36c056" PRIMARY KEY (id);


--
-- Name: auth_sessions PK_auth_sessions; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT "PK_auth_sessions" PRIMARY KEY (id);


--
-- Name: authorized_bank_accounts PK_authorized_bank_accounts; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.authorized_bank_accounts
    ADD CONSTRAINT "PK_authorized_bank_accounts" PRIMARY KEY (id);


--
-- Name: extras_servicio PK_c64a18b9e5925dd382e22a7d1cb; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extras_servicio
    ADD CONSTRAINT "PK_c64a18b9e5925dd382e22a7d1cb" PRIMARY KEY (id);


--
-- Name: conduct_reports PK_conduct_reports; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conduct_reports
    ADD CONSTRAINT "PK_conduct_reports" PRIMARY KEY (id);


--
-- Name: usuarios PK_d7281c63c176e152e4c531594a8; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT "PK_d7281c63c176e152e4c531594a8" PRIMARY KEY (id);


--
-- Name: clientes PK_d76bf3571d906e4e86470482c08; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT "PK_d76bf3571d906e4e86470482c08" PRIMARY KEY (id);


--
-- Name: loyalty_transactions PK_df453f678b7575221b335673362; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT "PK_df453f678b7575221b335673362" PRIMARY KEY (id);


--
-- Name: disciplinary_sanctions PK_disciplinary_sanctions; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disciplinary_sanctions
    ADD CONSTRAINT "PK_disciplinary_sanctions" PRIMARY KEY (id);


--
-- Name: empleadas PK_eb80f0b7bfd01557cc5cebefc39; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empleadas
    ADD CONSTRAINT "PK_eb80f0b7bfd01557cc5cebefc39" PRIMARY KEY (id);


--
-- Name: employee_report_history PK_employee_report_history; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_report_history
    ADD CONSTRAINT "PK_employee_report_history" PRIMARY KEY (id);


--
-- Name: employee_reports PK_employee_reports; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_reports
    ADD CONSTRAINT "PK_employee_reports" PRIMARY KEY (id);


--
-- Name: apartments PK_f6058e85d6d715dbe22b72fe722; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apartments
    ADD CONSTRAINT "PK_f6058e85d6d715dbe22b72fe722" PRIMARY KEY (id);


--
-- Name: servicios PK_fefcdbfeaf506ca485a6dcfb0d8; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicios
    ADD CONSTRAINT "PK_fefcdbfeaf506ca485a6dcfb0d8" PRIMARY KEY (id);


--
-- Name: interaction_ratings PK_interaction_ratings; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_ratings
    ADD CONSTRAINT "PK_interaction_ratings" PRIMARY KEY (id);


--
-- Name: liquidation_audit_log PK_liquidation_audit_log; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.liquidation_audit_log
    ADD CONSTRAINT "PK_liquidation_audit_log" PRIMARY KEY (id);


--
-- Name: liquidation_debts PK_liquidation_debts; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.liquidation_debts
    ADD CONSTRAINT "PK_liquidation_debts" PRIMARY KEY (id);


--
-- Name: liquidation_payments PK_liquidation_payments; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.liquidation_payments
    ADD CONSTRAINT "PK_liquidation_payments" PRIMARY KEY (id);


--
-- Name: liquidation_records PK_liquidation_records; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.liquidation_records
    ADD CONSTRAINT "PK_liquidation_records" PRIMARY KEY (id);


--
-- Name: payment_receipt_validations PK_payment_receipt_validations; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_receipt_validations
    ADD CONSTRAINT "PK_payment_receipt_validations" PRIMARY KEY (id);


--
-- Name: user_preferences PK_user_preferences; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT "PK_user_preferences" PRIMARY KEY (user_id, key);


--
-- Name: empleadas UQ_25d5846d1a089d3ca5900636185; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empleadas
    ADD CONSTRAINT "UQ_25d5846d1a089d3ca5900636185" UNIQUE (slug_catalogo);


--
-- Name: choferes UQ_2dea093853d48942891f276ad9c; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.choferes
    ADD CONSTRAINT "UQ_2dea093853d48942891f276ad9c" UNIQUE (usuario_id);


--
-- Name: usuarios UQ_446adfc18b35418aac32ae0b7b5; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT "UQ_446adfc18b35418aac32ae0b7b5" UNIQUE (email);


--
-- Name: empleadas UQ_4dac7fbb10edd9adffa303cf6fc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empleadas
    ADD CONSTRAINT "UQ_4dac7fbb10edd9adffa303cf6fc" UNIQUE (usuario_id);


--
-- Name: loyalty_tiers UQ_65c10c10fc8319506a8119998a0; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_tiers
    ADD CONSTRAINT "UQ_65c10c10fc8319506a8119998a0" UNIQUE (code);


--
-- Name: client_memberships UQ_a9354c010ed1e0ffafd75f0fda1; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_memberships
    ADD CONSTRAINT "UQ_a9354c010ed1e0ffafd75f0fda1" UNIQUE (cliente_id);


--
-- Name: weekly_content_schedules UQ_weekly_content_schedules_empleada_semana; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_content_schedules
    ADD CONSTRAINT "UQ_weekly_content_schedules_empleada_semana" UNIQUE (empleada_id, semana_inicio);


--
-- Name: candidate_screening_answers candidate_screening_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_screening_answers
    ADD CONSTRAINT candidate_screening_answers_pkey PRIMARY KEY (id);


--
-- Name: candidate_screening_answers candidate_screening_answers_screening_question_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_screening_answers
    ADD CONSTRAINT candidate_screening_answers_screening_question_key UNIQUE (screening_id, question_id);


--
-- Name: candidate_screenings candidate_screenings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_screenings
    ADD CONSTRAINT candidate_screenings_pkey PRIMARY KEY (id);


--
-- Name: candidate_screenings candidate_screenings_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_screenings
    ADD CONSTRAINT candidate_screenings_token_key UNIQUE (token);


--
-- Name: challenge_participants challenge_participants_challenge_participant_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_participants
    ADD CONSTRAINT challenge_participants_challenge_participant_key UNIQUE (challenge_id, participant_id);


--
-- Name: challenge_participants challenge_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_participants
    ADD CONSTRAINT challenge_participants_pkey PRIMARY KEY (id);


--
-- Name: challenges challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenges
    ADD CONSTRAINT challenges_pkey PRIMARY KEY (id);


--
-- Name: customer_booking_sessions customer_booking_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_booking_sessions
    ADD CONSTRAINT customer_booking_sessions_pkey PRIMARY KEY (id);


--
-- Name: customer_booking_sessions customer_booking_sessions_service_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_booking_sessions
    ADD CONSTRAINT customer_booking_sessions_service_id_key UNIQUE (service_id);


--
-- Name: driver_settlements driver_settlements_driver_id_week_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_settlements
    ADD CONSTRAINT driver_settlements_driver_id_week_start_key UNIQUE (driver_id, week_start);


--
-- Name: driver_settlements driver_settlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_settlements
    ADD CONSTRAINT driver_settlements_pkey PRIMARY KEY (id);


--
-- Name: driver_shift_assignments driver_shift_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_shift_assignments
    ADD CONSTRAINT driver_shift_assignments_pkey PRIMARY KEY (id);


--
-- Name: driver_shift_assignments driver_shift_assignments_shift_driver_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_shift_assignments
    ADD CONSTRAINT driver_shift_assignments_shift_driver_key UNIQUE (shift_id, driver_id);


--
-- Name: driver_shifts driver_shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_shifts
    ADD CONSTRAINT driver_shifts_pkey PRIMARY KEY (id);


--
-- Name: empleada_fotos_exclusivas empleada_fotos_exclusivas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empleada_fotos_exclusivas
    ADD CONSTRAINT empleada_fotos_exclusivas_pkey PRIMARY KEY (id);


--
-- Name: employee_cash_obligations employee_cash_obligations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_cash_obligations
    ADD CONSTRAINT employee_cash_obligations_pkey PRIMARY KEY (id);


--
-- Name: employee_cash_obligations employee_cash_obligations_service_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_cash_obligations
    ADD CONSTRAINT employee_cash_obligations_service_id_key UNIQUE (service_id);


--
-- Name: employee_cash_payment_allocations employee_cash_payment_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_cash_payment_allocations
    ADD CONSTRAINT employee_cash_payment_allocations_pkey PRIMARY KEY (payment_id, obligation_id);


--
-- Name: employee_cash_payments employee_cash_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_cash_payments
    ADD CONSTRAINT employee_cash_payments_pkey PRIMARY KEY (id);


--
-- Name: employee_onboardings employee_onboardings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_onboardings
    ADD CONSTRAINT employee_onboardings_pkey PRIMARY KEY (id);


--
-- Name: employee_rating_snapshots employee_rating_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_rating_snapshots
    ADD CONSTRAINT employee_rating_snapshots_pkey PRIMARY KEY (id);


--
-- Name: employee_regulations employee_regulations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_regulations
    ADD CONSTRAINT employee_regulations_pkey PRIMARY KEY (id);


--
-- Name: employee_weekly_settlements employee_weekly_settlements_employee_id_week_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_weekly_settlements
    ADD CONSTRAINT employee_weekly_settlements_employee_id_week_start_key UNIQUE (employee_id, week_start);


--
-- Name: employee_weekly_settlements employee_weekly_settlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_weekly_settlements
    ADD CONSTRAINT employee_weekly_settlements_pkey PRIMARY KEY (id);


--
-- Name: group_service_request_selections group_service_request_selections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_service_request_selections
    ADD CONSTRAINT group_service_request_selections_pkey PRIMARY KEY (id);


--
-- Name: group_service_requests group_service_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_service_requests
    ADD CONSTRAINT group_service_requests_pkey PRIMARY KEY (id);


--
-- Name: group_service_requests group_service_requests_service_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_service_requests
    ADD CONSTRAINT group_service_requests_service_id_key UNIQUE (service_id);


--
-- Name: liquidation_settings liquidation_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.liquidation_settings
    ADD CONSTRAINT liquidation_settings_pkey PRIMARY KEY (id);


--
-- Name: mensajes_equipo mensajes_equipo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mensajes_equipo
    ADD CONSTRAINT mensajes_equipo_pkey PRIMARY KEY (id);


--
-- Name: conversations pk_conversations; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT pk_conversations PRIMARY KEY (id);


--
-- Name: messages pk_messages; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT pk_messages PRIMARY KEY (id);


--
-- Name: post_likes pk_post_likes; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_likes
    ADD CONSTRAINT pk_post_likes PRIMARY KEY (post_id, client_id);


--
-- Name: post_media pk_post_media; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_media
    ADD CONSTRAINT pk_post_media PRIMARY KEY (id);


--
-- Name: posts pk_posts; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT pk_posts PRIMARY KEY (id);


--
-- Name: verificaciones_correo pk_verificaciones_correo; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verificaciones_correo
    ADD CONSTRAINT pk_verificaciones_correo PRIMARY KEY (id);


--
-- Name: preset_service_locations preset_service_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preset_service_locations
    ADD CONSTRAINT preset_service_locations_pkey PRIMARY KEY (id);


--
-- Name: push_notification_events push_notification_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_notification_events
    ADD CONSTRAINT push_notification_events_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: questionnaire_answers questionnaire_answers_attempt_question_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questionnaire_answers
    ADD CONSTRAINT questionnaire_answers_attempt_question_key UNIQUE (attempt_id, question_id);


--
-- Name: questionnaire_answers questionnaire_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questionnaire_answers
    ADD CONSTRAINT questionnaire_answers_pkey PRIMARY KEY (id);


--
-- Name: questionnaire_attempts questionnaire_attempts_onboarding_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questionnaire_attempts
    ADD CONSTRAINT questionnaire_attempts_onboarding_number_key UNIQUE (onboarding_id, attempt_number);


--
-- Name: questionnaire_attempts questionnaire_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questionnaire_attempts
    ADD CONSTRAINT questionnaire_attempts_pkey PRIMARY KEY (id);


--
-- Name: realtime_outbox realtime_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.realtime_outbox
    ADD CONSTRAINT realtime_outbox_pkey PRIMARY KEY (id);


--
-- Name: regulation_options regulation_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regulation_options
    ADD CONSTRAINT regulation_options_pkey PRIMARY KEY (id);


--
-- Name: regulation_questions regulation_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regulation_questions
    ADD CONSTRAINT regulation_questions_pkey PRIMARY KEY (id);


--
-- Name: screening_questions screening_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.screening_questions
    ADD CONSTRAINT screening_questions_pkey PRIMARY KEY (id);


--
-- Name: service_admin_audit service_admin_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_admin_audit
    ADD CONSTRAINT service_admin_audit_pkey PRIMARY KEY (id);


--
-- Name: service_group_audit service_group_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_group_audit
    ADD CONSTRAINT service_group_audit_pkey PRIMARY KEY (id);


--
-- Name: service_operation_events service_operation_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_operation_events
    ADD CONSTRAINT service_operation_events_pkey PRIMARY KEY (id);


--
-- Name: service_participants service_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_participants
    ADD CONSTRAINT service_participants_pkey PRIMARY KEY (id);


--
-- Name: service_payments service_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_payments
    ADD CONSTRAINT service_payments_pkey PRIMARY KEY (id);


--
-- Name: solicitudes_servicio_manual solicitudes_servicio_manual_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitudes_servicio_manual
    ADD CONSTRAINT solicitudes_servicio_manual_pkey PRIMARY KEY (id);


--
-- Name: transport_settings transport_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transport_settings
    ADD CONSTRAINT transport_settings_pkey PRIMARY KEY (id);


--
-- Name: trip_passengers trip_passengers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_passengers
    ADD CONSTRAINT trip_passengers_pkey PRIMARY KEY (id);


--
-- Name: group_service_request_selections uq_group_request_employee; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_service_request_selections
    ADD CONSTRAINT uq_group_request_employee UNIQUE (request_id, employee_id);


--
-- Name: post_media uq_post_media_post_position; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_media
    ADD CONSTRAINT uq_post_media_post_position UNIQUE (post_id, "position") DEFERRABLE INITIALLY DEFERRED;


--
-- Name: push_notification_events uq_push_notification_events_user_dedupe; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_notification_events
    ADD CONSTRAINT uq_push_notification_events_user_dedupe UNIQUE (usuario_id, dedupe_key);


--
-- Name: service_participants uq_service_participant; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_participants
    ADD CONSTRAINT uq_service_participant UNIQUE (service_id, employee_id);


--
-- Name: trip_passengers uq_trip_passenger; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_passengers
    ADD CONSTRAINT uq_trip_passenger UNIQUE (trip_id, employee_id);


--
-- Name: weekly_content_schedules weekly_content_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_content_schedules
    ADD CONSTRAINT weekly_content_schedules_pkey PRIMARY KEY (id);


--
-- Name: weekly_photo_submissions weekly_photo_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_photo_submissions
    ADD CONSTRAINT weekly_photo_submissions_pkey PRIMARY KEY (id);


--
-- Name: IDX_auth_sessions_family_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_auth_sessions_family_id" ON public.auth_sessions USING btree (family_id);


--
-- Name: IDX_auth_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_auth_sessions_user_id" ON public.auth_sessions USING btree (user_id);


--
-- Name: IDX_conduct_reports_subject_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_conduct_reports_subject_created" ON public.conduct_reports USING btree (subject_type, subject_id, created_at);


--
-- Name: IDX_disciplinary_sanctions_subject_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_disciplinary_sanctions_subject_status" ON public.disciplinary_sanctions USING btree (subject_type, subject_id, status);


--
-- Name: IDX_employee_cash_payments_employee_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_employee_cash_payments_employee_created" ON public.employee_cash_payments USING btree (employee_id, created_at DESC);


--
-- Name: IDX_interaction_rating_employee_direction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_interaction_rating_employee_direction" ON public.interaction_ratings USING btree (employee_id, direction);


--
-- Name: UQ_conduct_report_interaction_category; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "UQ_conduct_report_interaction_category" ON public.conduct_reports USING btree (direction, COALESCE(trip_id, service_id), reporter_id, category);


--
-- Name: UQ_interaction_rating_service_direction_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "UQ_interaction_rating_service_direction_employee" ON public.interaction_ratings USING btree (direction, service_id, employee_id) WHERE ((service_id IS NOT NULL) AND (trip_id IS NULL));


--
-- Name: UQ_interaction_rating_trip_direction; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "UQ_interaction_rating_trip_direction" ON public.interaction_ratings USING btree (direction, trip_id) WHERE (trip_id IS NOT NULL);


--
-- Name: alertas_clientes_pkey; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX alertas_clientes_pkey ON public.alertas_clientes USING btree (id);


--
-- Name: choferes_pkey; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX choferes_pkey ON public.choferes USING btree (id);


--
-- Name: choferes_usuario_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX choferes_usuario_id_key ON public.choferes USING btree (usuario_id);


--
-- Name: client_memberships_cliente_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX client_memberships_cliente_id_key ON public.client_memberships USING btree (cliente_id);


--
-- Name: clientes_pkey; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX clientes_pkey ON public.clientes USING btree (id);


--
-- Name: empleada_fotos_empleada_id_orden_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX empleada_fotos_empleada_id_orden_key ON public.empleada_fotos USING btree (empleada_id, orden);


--
-- Name: empleada_fotos_pkey; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX empleada_fotos_pkey ON public.empleada_fotos USING btree (id);


--
-- Name: empleadas_pkey; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX empleadas_pkey ON public.empleadas USING btree (id);


--
-- Name: empleadas_slug_catalogo_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX empleadas_slug_catalogo_key ON public.empleadas USING btree (slug_catalogo);


--
-- Name: empleadas_usuario_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX empleadas_usuario_id_key ON public.empleadas USING btree (usuario_id);


--
-- Name: employee_onboardings_one_active_per_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX employee_onboardings_one_active_per_user ON public.employee_onboardings USING btree (user_id) WHERE (active = true);


--
-- Name: extensiones_servicio_pkey; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX extensiones_servicio_pkey ON public.extensiones_servicio USING btree (id);


--
-- Name: extras_catalogo_pkey; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX extras_catalogo_pkey ON public.extras_catalogo USING btree (id);


--
-- Name: extras_servicio_pkey; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX extras_servicio_pkey ON public.extras_servicio USING btree (id);


--
-- Name: idx_alertas_atendida; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alertas_atendida ON public.alertas_clientes USING btree (atendida);


--
-- Name: idx_alertas_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alertas_cliente ON public.alertas_clientes USING btree (cliente_id);


--
-- Name: idx_alertas_servicio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alertas_servicio ON public.alertas_clientes USING btree (servicio_id);


--
-- Name: idx_auth_sessions_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_sessions_expires_at ON public.auth_sessions USING btree (expires_at);


--
-- Name: idx_auth_sessions_revoked_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_sessions_revoked_at ON public.auth_sessions USING btree (revoked_at) WHERE (revoked_at IS NOT NULL);


--
-- Name: idx_candidate_screenings_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidate_screenings_status ON public.candidate_screenings USING btree (status);


--
-- Name: idx_challenges_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_challenges_status ON public.challenges USING btree (status);


--
-- Name: idx_choferes_disponible; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_choferes_disponible ON public.choferes USING btree (disponible);


--
-- Name: idx_client_memberships_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_memberships_tier ON public.client_memberships USING btree (tier_id);


--
-- Name: idx_conduct_reports_con_descargo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conduct_reports_con_descargo ON public.conduct_reports USING btree (subject_statement_at DESC) WHERE ((subject_statement IS NOT NULL) AND ((status)::text <> 'cerrado'::text));


--
-- Name: idx_conversations_client_last_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_client_last_message ON public.conversations USING btree (client_id, last_message_at);


--
-- Name: idx_conversations_employee_last_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_employee_last_message ON public.conversations USING btree (employee_id, last_message_at);


--
-- Name: idx_conversations_human_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_human_owner ON public.conversations USING btree (human_owner_id);


--
-- Name: idx_conversations_service; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_service ON public.conversations USING btree (service_id);


--
-- Name: idx_customer_booking_sessions_client_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_booking_sessions_client_status ON public.customer_booking_sessions USING btree (client_id, status);


--
-- Name: idx_customer_booking_sessions_employee_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_booking_sessions_employee_status ON public.customer_booking_sessions USING btree (intended_employee_id, status);


--
-- Name: idx_customer_booking_sessions_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_booking_sessions_updated_at ON public.customer_booking_sessions USING btree (updated_at);


--
-- Name: idx_driver_shift_assignments_driver; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_driver_shift_assignments_driver ON public.driver_shift_assignments USING btree (driver_id);


--
-- Name: idx_driver_shifts_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_driver_shifts_active ON public.driver_shifts USING btree (active);


--
-- Name: idx_empleada_fotos_empleada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_empleada_fotos_empleada ON public.empleada_fotos USING btree (empleada_id);


--
-- Name: idx_empleada_fotos_exclusivas_empleada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_empleada_fotos_exclusivas_empleada ON public.empleada_fotos_exclusivas USING btree (empleada_id);


--
-- Name: idx_empleadas_catalogo_activo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_empleadas_catalogo_activo ON public.empleadas USING btree (catalogo_activo);


--
-- Name: idx_empleadas_disponible; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_empleadas_disponible ON public.empleadas USING btree (disponible);


--
-- Name: idx_employee_cash_obligations_employee_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_cash_obligations_employee_status ON public.employee_cash_obligations USING btree (employee_id, status, created_at);


--
-- Name: idx_employee_onboardings_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_onboardings_employee ON public.employee_onboardings USING btree (employee_id);


--
-- Name: idx_employee_onboardings_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_onboardings_pending ON public.employee_onboardings USING btree (active, status, assigned_at);


--
-- Name: idx_employee_onboardings_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_onboardings_user ON public.employee_onboardings USING btree (user_id);


--
-- Name: idx_employee_rating_snapshots_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_rating_snapshots_employee ON public.employee_rating_snapshots USING btree (employee_id, created_at);


--
-- Name: idx_employee_report_history_report_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_report_history_report_created ON public.employee_report_history USING btree (report_id, created_at);


--
-- Name: idx_employee_reports_boss_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_reports_boss_created ON public.employee_reports USING btree (boss_id, created_at);


--
-- Name: idx_employee_reports_employee_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_reports_employee_created ON public.employee_reports USING btree (employee_id, created_at);


--
-- Name: idx_employee_reports_status_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_reports_status_priority ON public.employee_reports USING btree (status, priority);


--
-- Name: idx_extensiones_servicio_servicio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_extensiones_servicio_servicio ON public.extensiones_servicio USING btree (servicio_id);


--
-- Name: idx_extras_catalogo_empleada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_extras_catalogo_empleada ON public.extras_catalogo USING btree (empleada_id);


--
-- Name: idx_extras_catalogo_empleada_activo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_extras_catalogo_empleada_activo ON public.extras_catalogo USING btree (empleada_id, activo);


--
-- Name: idx_extras_servicio_catalogo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_extras_servicio_catalogo ON public.extras_servicio USING btree (extra_catalogo_id);


--
-- Name: idx_extras_servicio_servicio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_extras_servicio_servicio ON public.extras_servicio USING btree (servicio_id);


--
-- Name: idx_group_audit_request_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_audit_request_created ON public.service_group_audit USING btree (request_id, created_at);


--
-- Name: idx_group_audit_service_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_audit_service_created ON public.service_group_audit USING btree (service_id, created_at);


--
-- Name: idx_group_requests_boss_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_requests_boss_status ON public.group_service_requests USING btree (boss_id, status);


--
-- Name: idx_group_requests_client_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_requests_client_status ON public.group_service_requests USING btree (client_id, status);


--
-- Name: idx_group_requests_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_requests_conversation ON public.group_service_requests USING btree (conversation_id) WHERE (conversation_id IS NOT NULL);


--
-- Name: idx_group_selection_hold; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_selection_hold ON public.group_service_request_selections USING btree (employee_id, status, expires_at);


--
-- Name: idx_interaction_ratings_appeal_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interaction_ratings_appeal_status ON public.interaction_ratings USING btree (appeal_status);


--
-- Name: idx_liquidation_audit_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_liquidation_audit_entity ON public.liquidation_audit_log USING btree (entity_type, entity_id);


--
-- Name: idx_liquidation_debts_employee_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_liquidation_debts_employee_status ON public.liquidation_debts USING btree (employee_id, status) WHERE (deleted_at IS NULL);


--
-- Name: idx_liquidation_payments_debt_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_liquidation_payments_debt_created ON public.liquidation_payments USING btree (debt_id, created_at) WHERE (deleted_at IS NULL);


--
-- Name: idx_liquidation_records_employee_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_liquidation_records_employee_date ON public.liquidation_records USING btree (employee_id, occurred_at);


--
-- Name: idx_liquidation_records_occurred_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_liquidation_records_occurred_at ON public.liquidation_records USING btree (occurred_at);


--
-- Name: idx_loyalty_tiers_active_min_spend; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_tiers_active_min_spend ON public.loyalty_tiers USING btree (active, min_spend);


--
-- Name: idx_loyalty_transactions_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_transactions_cliente ON public.loyalty_transactions USING btree (cliente_id);


--
-- Name: idx_loyalty_transactions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_transactions_created_at ON public.loyalty_transactions USING btree (created_at);


--
-- Name: idx_loyalty_transactions_servicio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_transactions_servicio ON public.loyalty_transactions USING btree (servicio_id);


--
-- Name: idx_mensajes_equipo_empleada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mensajes_equipo_empleada ON public.mensajes_equipo USING btree (empleada_id, created_at DESC);


--
-- Name: idx_mensajes_equipo_sin_leer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mensajes_equipo_sin_leer ON public.mensajes_equipo USING btree (empleada_id) WHERE (leido_at IS NULL);


--
-- Name: idx_messages_conversation_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conversation_created ON public.messages USING btree (conversation_id, created_at, id);


--
-- Name: idx_messages_receipt_validation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_receipt_validation ON public.messages USING btree (receipt_validation_id);


--
-- Name: idx_participant_employee_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participant_employee_status ON public.service_participants USING btree (employee_id, status);


--
-- Name: idx_payment_receipt_validations_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_receipt_validations_created ON public.payment_receipt_validations USING btree (created_at DESC);


--
-- Name: idx_payment_receipt_validations_servicio_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_receipt_validations_servicio_created ON public.payment_receipt_validations USING btree (servicio_id, created_at DESC);


--
-- Name: idx_post_likes_client_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_post_likes_client_created ON public.post_likes USING btree (client_id, created_at DESC);


--
-- Name: idx_posts_employee_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_employee_created ON public.posts USING btree (employee_id, created_at DESC);


--
-- Name: idx_posts_employee_feed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_employee_feed ON public.posts USING btree (employee_id, published_at DESC, id DESC) WHERE (status = 'aprobado'::public.posts_status_enum);


--
-- Name: idx_posts_employee_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_employee_pending ON public.posts USING btree (employee_id, submitted_at) WHERE (status = 'pendiente'::public.posts_status_enum);


--
-- Name: idx_posts_feed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_feed ON public.posts USING btree (published_at DESC, id DESC) WHERE (status = 'aprobado'::public.posts_status_enum);


--
-- Name: idx_preset_service_locations_active_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_preset_service_locations_active_order ON public.preset_service_locations USING btree (active, sort_order);


--
-- Name: idx_prorrogas_servicio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prorrogas_servicio ON public.prorrogas USING btree (servicio_id);


--
-- Name: idx_push_notification_events_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_notification_events_created ON public.push_notification_events USING btree (created_at);


--
-- Name: idx_push_notification_events_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_notification_events_user ON public.push_notification_events USING btree (usuario_id);


--
-- Name: idx_push_subscriptions_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_subscriptions_usuario ON public.push_subscriptions USING btree (usuario_id);


--
-- Name: idx_realtime_outbox_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_realtime_outbox_created_at ON public.realtime_outbox USING btree (created_at);


--
-- Name: idx_regulation_options_question; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_regulation_options_question ON public.regulation_options USING btree (question_id, display_order);


--
-- Name: idx_regulation_questions_publication; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_regulation_questions_publication ON public.regulation_questions USING btree (regulation_id, publication_key, display_order);


--
-- Name: idx_service_admin_audit_service_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_admin_audit_service_created ON public.service_admin_audit USING btree (service_id, created_at DESC);


--
-- Name: idx_service_extras_participant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_extras_participant ON public.extras_servicio USING btree (participant_id);


--
-- Name: idx_service_operation_events_service_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_operation_events_service_time ON public.service_operation_events USING btree (service_id, occurred_at);


--
-- Name: idx_service_operation_events_type_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_operation_events_type_time ON public.service_operation_events USING btree (type, occurred_at);


--
-- Name: idx_service_payments_service_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_payments_service_status ON public.service_payments USING btree (service_id, status);


--
-- Name: idx_servicios_aceptacion_expira; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servicios_aceptacion_expira ON public.servicios USING btree (aceptacion_empleada_expira_at) WHERE ((estado_operativo)::text = 'esperando_aceptacion_empleada'::text);


--
-- Name: idx_servicios_booking_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servicios_booking_session ON public.servicios USING btree (booking_session_id);


--
-- Name: idx_servicios_cliente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servicios_cliente ON public.servicios USING btree (cliente_id);


--
-- Name: idx_servicios_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servicios_created_at ON public.servicios USING btree (created_at);


--
-- Name: idx_servicios_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servicios_deleted_at ON public.servicios USING btree (deleted_at);


--
-- Name: idx_servicios_empleada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servicios_empleada ON public.servicios USING btree (empleada_id);


--
-- Name: idx_servicios_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servicios_estado ON public.servicios USING btree (estado);


--
-- Name: idx_servicios_estado_operativo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servicios_estado_operativo ON public.servicios USING btree (estado_operativo);


--
-- Name: idx_servicios_fecha_programada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servicios_fecha_programada ON public.servicios USING btree (estado, fecha_programada) WHERE (fecha_programada IS NOT NULL);


--
-- Name: idx_servicios_jefe; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servicios_jefe ON public.servicios USING btree (jefe_id);


--
-- Name: idx_servicios_motivo_cancelacion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servicios_motivo_cancelacion ON public.servicios USING btree (motivo_cancelacion, cancelado_at) WHERE (motivo_cancelacion IS NOT NULL);


--
-- Name: idx_servicios_previo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_servicios_previo ON public.servicios USING btree (servicio_previo_id) WHERE (servicio_previo_id IS NOT NULL);


--
-- Name: idx_solicitud_manual_empleada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_solicitud_manual_empleada ON public.solicitudes_servicio_manual USING btree (empleada_id, created_at DESC);


--
-- Name: idx_solicitud_manual_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_solicitud_manual_estado ON public.solicitudes_servicio_manual USING btree (estado, created_at DESC);


--
-- Name: idx_usuarios_email_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usuarios_email_lower ON public.usuarios USING btree (lower((email)::text));


--
-- Name: idx_usuarios_fuera_de_jornada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usuarios_fuera_de_jornada ON public.usuarios USING btree (rol, jornada_actualizada_at) WHERE (en_jornada = false);


--
-- Name: idx_usuarios_rol; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usuarios_rol ON public.usuarios USING btree (rol);


--
-- Name: idx_verificaciones_correo_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_verificaciones_correo_usuario ON public.verificaciones_correo USING btree (usuario_id);


--
-- Name: idx_viajes_cancelado_con_costo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_viajes_cancelado_con_costo ON public.viajes USING btree (cancelado_con_costo) WHERE ((cancelado_con_costo = true) AND (fare_confirmed_at IS NULL));


--
-- Name: idx_viajes_chofer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_viajes_chofer ON public.viajes USING btree (chofer_id);


--
-- Name: idx_viajes_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_viajes_estado ON public.viajes USING btree (estado);


--
-- Name: idx_viajes_oferta_expira_en; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_viajes_oferta_expira_en ON public.viajes USING btree (oferta_expira_en) WHERE (oferta_expira_en IS NOT NULL);


--
-- Name: idx_viajes_servicio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_viajes_servicio ON public.viajes USING btree (servicio_id);


--
-- Name: idx_viajes_servicio_tipo_unidad_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_viajes_servicio_tipo_unidad_key ON public.viajes USING btree (servicio_id, tipo, unit_number);


--
-- Name: idx_weekly_content_schedules_empleada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_weekly_content_schedules_empleada ON public.weekly_content_schedules USING btree (empleada_id);


--
-- Name: idx_weekly_photo_submissions_empleada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_weekly_photo_submissions_empleada ON public.weekly_photo_submissions USING btree (empleada_id);


--
-- Name: idx_weekly_photo_submissions_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_weekly_photo_submissions_estado ON public.weekly_photo_submissions USING btree (estado);


--
-- Name: loyalty_tiers_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX loyalty_tiers_code_key ON public.loyalty_tiers USING btree (code);


--
-- Name: loyalty_transactions_service_type_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX loyalty_transactions_service_type_key ON public.loyalty_transactions USING btree (servicio_id, type);


--
-- Name: prorrogas_pkey; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX prorrogas_pkey ON public.prorrogas USING btree (id);


--
-- Name: prorrogas_servicio_id_numero_prorroga_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX prorrogas_servicio_id_numero_prorroga_key ON public.prorrogas USING btree (numero_prorroga, servicio_id);


--
-- Name: servicios_pkey; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX servicios_pkey ON public.servicios USING btree (id);


--
-- Name: uq_clientes_usuario_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_clientes_usuario_id ON public.clientes USING btree (usuario_id);


--
-- Name: uq_conversations_booking_session; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_conversations_booking_session ON public.conversations USING btree (booking_session_id);


--
-- Name: uq_conversations_client_employee_open; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_conversations_client_employee_open ON public.conversations USING btree (client_id, employee_id) WHERE (status <> 'cerrada'::public.conversations_status_enum);


--
-- Name: uq_employee_reports_historical_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_employee_reports_historical_reference ON public.employee_reports USING btree (reporter_key, COALESCE(service_id, historical_service_id), category);


--
-- Name: uq_liquidation_records_service_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_liquidation_records_service_employee ON public.liquidation_records USING btree (service_id, employee_id) WHERE (service_id IS NOT NULL);


--
-- Name: uq_messages_conversation_client_message; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_messages_conversation_client_message ON public.messages USING btree (conversation_id, client_message_id) WHERE (client_message_id IS NOT NULL);


--
-- Name: uq_receipt_confirmed_spei_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_receipt_confirmed_spei_key ON public.payment_receipt_validations USING btree (upper((id_spei)::text)) WHERE ((pago_confirmado_at IS NOT NULL) AND (id_spei IS NOT NULL));


--
-- Name: uq_service_payment_fingerprint; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_service_payment_fingerprint ON public.service_payments USING btree (fingerprint) WHERE (fingerprint IS NOT NULL);


--
-- Name: uq_service_responsible; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_service_responsible ON public.service_participants USING btree (service_id) WHERE (((role)::text = 'responsable'::text) AND ((status)::text <> 'cancelada'::text));


--
-- Name: uq_servicio_siguiente_por_empleada; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_servicio_siguiente_por_empleada ON public.servicios USING btree (empleada_id) WHERE ((estado = ANY (ARRAY['pendiente'::public.servicios_estado_enum, 'agendado'::public.servicios_estado_enum])) AND (servicio_previo_id IS NOT NULL));


--
-- Name: uq_verificaciones_correo_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_verificaciones_correo_token ON public.verificaciones_correo USING btree (token_hash);


--
-- Name: usuarios_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX usuarios_email_key ON public.usuarios USING btree (email);


--
-- Name: usuarios_pkey; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX usuarios_pkey ON public.usuarios USING btree (id);


--
-- Name: viajes_pkey; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX viajes_pkey ON public.viajes USING btree (id);


--
-- Name: post_likes trg_post_likes_like_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_post_likes_like_count AFTER INSERT OR DELETE ON public.post_likes FOR EACH ROW EXECUTE FUNCTION public.actualizar_like_count_post();


--
-- Name: interaction_ratings trigger_actualizar_metricas_empleada_rating; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_actualizar_metricas_empleada_rating AFTER INSERT OR DELETE OR UPDATE OF stars, direction, employee_id ON public.interaction_ratings FOR EACH ROW EXECUTE FUNCTION public.actualizar_metricas_empleada_desde_rating();


--
-- Name: extras_servicio trigger_actualizar_total_extras_servicio; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_actualizar_total_extras_servicio AFTER INSERT OR DELETE OR UPDATE ON public.extras_servicio FOR EACH ROW EXECUTE FUNCTION public.actualizar_total_extras_servicio();


--
-- Name: service_payments trigger_actualizar_total_pagos; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_actualizar_total_pagos AFTER INSERT OR DELETE OR UPDATE ON public.service_payments FOR EACH ROW EXECUTE FUNCTION public.actualizar_total_pagos();


--
-- Name: service_participants trigger_actualizar_total_participantes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_actualizar_total_participantes AFTER INSERT OR DELETE OR UPDATE ON public.service_participants FOR EACH ROW EXECUTE FUNCTION public.actualizar_total_participantes();


--
-- Name: viajes trigger_actualizar_total_transporte; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_actualizar_total_transporte AFTER INSERT OR DELETE OR UPDATE OF tarifa, estado, servicio_id ON public.viajes FOR EACH ROW EXECUTE FUNCTION public.actualizar_total_transporte_servicio();


--
-- Name: servicios trigger_calcular_total_servicio; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_calcular_total_servicio BEFORE INSERT OR UPDATE ON public.servicios FOR EACH ROW EXECUTE FUNCTION public.calcular_total_servicio();


--
-- Name: client_memberships FK_0d0378eabcdfe2df632c2be77b7; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_memberships
    ADD CONSTRAINT "FK_0d0378eabcdfe2df632c2be77b7" FOREIGN KEY (assigned_by_user_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: empleada_fotos FK_1fb684931383502b5e8cb80f4fc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empleada_fotos
    ADD CONSTRAINT "FK_1fb684931383502b5e8cb80f4fc" FOREIGN KEY (empleada_id) REFERENCES public.empleadas(id) ON DELETE CASCADE;


--
-- Name: servicios FK_1fd705987516f6766736a579a74; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicios
    ADD CONSTRAINT "FK_1fd705987516f6766736a579a74" FOREIGN KEY (empleada_id) REFERENCES public.empleadas(id) ON DELETE RESTRICT;


--
-- Name: servicios FK_2222734377bc9808ae98cf12ff1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicios
    ADD CONSTRAINT "FK_2222734377bc9808ae98cf12ff1" FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE RESTRICT;


--
-- Name: extensiones_servicio FK_27b5b99c53fe3aa1df1907e55a1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extensiones_servicio
    ADD CONSTRAINT "FK_27b5b99c53fe3aa1df1907e55a1" FOREIGN KEY (servicio_id) REFERENCES public.servicios(id) ON DELETE CASCADE;


--
-- Name: choferes FK_2dea093853d48942891f276ad9c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.choferes
    ADD CONSTRAINT "FK_2dea093853d48942891f276ad9c" FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: empleadas FK_4dac7fbb10edd9adffa303cf6fc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empleadas
    ADD CONSTRAINT "FK_4dac7fbb10edd9adffa303cf6fc" FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: alertas_clientes FK_59fbac54f7f7570d04cc2c49a9e; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alertas_clientes
    ADD CONSTRAINT "FK_59fbac54f7f7570d04cc2c49a9e" FOREIGN KEY (atendida_por) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: viajes FK_5e53ccfba23544aa492c4172ad5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.viajes
    ADD CONSTRAINT "FK_5e53ccfba23544aa492c4172ad5" FOREIGN KEY (servicio_id) REFERENCES public.servicios(id) ON DELETE CASCADE;


--
-- Name: loyalty_transactions FK_615011ab7fef63fb9d7910aecef; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT "FK_615011ab7fef63fb9d7910aecef" FOREIGN KEY (servicio_id) REFERENCES public.servicios(id) ON DELETE SET NULL;


--
-- Name: prorrogas FK_7b97a28815b0b51ffa0c2cfa508; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prorrogas
    ADD CONSTRAINT "FK_7b97a28815b0b51ffa0c2cfa508" FOREIGN KEY (servicio_id) REFERENCES public.servicios(id) ON DELETE CASCADE;


--
-- Name: servicios FK_86e006c066fd0dd3bdf8657768f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicios
    ADD CONSTRAINT "FK_86e006c066fd0dd3bdf8657768f" FOREIGN KEY (jefe_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: extras_servicio FK_9b43ecd4a3a08065ac16fa6f35a; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extras_servicio
    ADD CONSTRAINT "FK_9b43ecd4a3a08065ac16fa6f35a" FOREIGN KEY (servicio_id) REFERENCES public.servicios(id) ON DELETE CASCADE;


--
-- Name: empleadas FK_a0bcb1d816d94e6265647e69f80; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empleadas
    ADD CONSTRAINT "FK_a0bcb1d816d94e6265647e69f80" FOREIGN KEY (apartment_id) REFERENCES public.apartments(id) ON DELETE SET NULL;


--
-- Name: loyalty_transactions FK_a823912a8a7aa0115d2c0011f32; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT "FK_a823912a8a7aa0115d2c0011f32" FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE CASCADE;


--
-- Name: client_memberships FK_a9354c010ed1e0ffafd75f0fda1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_memberships
    ADD CONSTRAINT "FK_a9354c010ed1e0ffafd75f0fda1" FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE CASCADE;


--
-- Name: auth_sessions FK_auth_sessions_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT "FK_auth_sessions_user" FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: client_memberships FK_b51ff985e9dcecd3c99dcd3365a; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_memberships
    ADD CONSTRAINT "FK_b51ff985e9dcecd3c99dcd3365a" FOREIGN KEY (tier_id) REFERENCES public.loyalty_tiers(id) ON DELETE RESTRICT;


--
-- Name: loyalty_transactions FK_b78fb3d13da3b3d716f8b848515; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT "FK_b78fb3d13da3b3d716f8b848515" FOREIGN KEY (created_by_user_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: extras_catalogo FK_c021e5b34c1d635452614ef075c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extras_catalogo
    ADD CONSTRAINT "FK_c021e5b34c1d635452614ef075c" FOREIGN KEY (empleada_id) REFERENCES public.empleadas(id) ON DELETE CASCADE;


--
-- Name: empleadas FK_c75f4c706f7547b71d426ecb47f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empleadas
    ADD CONSTRAINT "FK_c75f4c706f7547b71d426ecb47f" FOREIGN KEY (jefe_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: alertas_clientes FK_c976596ebc7a3fd529701b44beb; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alertas_clientes
    ADD CONSTRAINT "FK_c976596ebc7a3fd529701b44beb" FOREIGN KEY (servicio_id) REFERENCES public.servicios(id) ON DELETE SET NULL;


--
-- Name: candidate_screening_answers FK_candidate_screening_answers_screening; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_screening_answers
    ADD CONSTRAINT "FK_candidate_screening_answers_screening" FOREIGN KEY (screening_id) REFERENCES public.candidate_screenings(id) ON DELETE CASCADE;


--
-- Name: candidate_screenings FK_candidate_screenings_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_screenings
    ADD CONSTRAINT "FK_candidate_screenings_created_by" FOREIGN KEY (created_by_user_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: candidate_screenings FK_candidate_screenings_promoted_employee; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_screenings
    ADD CONSTRAINT "FK_candidate_screenings_promoted_employee" FOREIGN KEY (promoted_employee_id) REFERENCES public.empleadas(id) ON DELETE SET NULL;


--
-- Name: challenge_participants FK_challenge_participants_challenge; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_participants
    ADD CONSTRAINT "FK_challenge_participants_challenge" FOREIGN KEY (challenge_id) REFERENCES public.challenges(id) ON DELETE CASCADE;


--
-- Name: challenges FK_challenges_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenges
    ADD CONSTRAINT "FK_challenges_created_by" FOREIGN KEY (created_by_user_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: conduct_reports FK_conduct_reports_admin; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conduct_reports
    ADD CONSTRAINT "FK_conduct_reports_admin" FOREIGN KEY (assigned_admin_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: conduct_reports FK_conduct_reports_service; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conduct_reports
    ADD CONSTRAINT "FK_conduct_reports_service" FOREIGN KEY (service_id) REFERENCES public.servicios(id) ON DELETE SET NULL;


--
-- Name: conduct_reports FK_conduct_reports_trip; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conduct_reports
    ADD CONSTRAINT "FK_conduct_reports_trip" FOREIGN KEY (trip_id) REFERENCES public.viajes(id) ON DELETE SET NULL;


--
-- Name: extras_servicio FK_dd3387bba65c6765cae6fa6c5b3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extras_servicio
    ADD CONSTRAINT "FK_dd3387bba65c6765cae6fa6c5b3" FOREIGN KEY (extra_catalogo_id) REFERENCES public.extras_catalogo(id) ON DELETE RESTRICT;


--
-- Name: extras_servicio FK_ddb5a9375897e2c22eddfeb1b08; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extras_servicio
    ADD CONSTRAINT "FK_ddb5a9375897e2c22eddfeb1b08" FOREIGN KEY (registrado_por) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: disciplinary_sanctions FK_disciplinary_sanctions_creator; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disciplinary_sanctions
    ADD CONSTRAINT "FK_disciplinary_sanctions_creator" FOREIGN KEY (created_by_user_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: disciplinary_sanctions FK_disciplinary_sanctions_report; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disciplinary_sanctions
    ADD CONSTRAINT "FK_disciplinary_sanctions_report" FOREIGN KEY (conduct_report_id) REFERENCES public.conduct_reports(id) ON DELETE SET NULL;


--
-- Name: disciplinary_sanctions FK_disciplinary_sanctions_revoker; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disciplinary_sanctions
    ADD CONSTRAINT "FK_disciplinary_sanctions_revoker" FOREIGN KEY (revoked_by_user_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: driver_shift_assignments FK_driver_shift_assignments_driver; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_shift_assignments
    ADD CONSTRAINT "FK_driver_shift_assignments_driver" FOREIGN KEY (driver_id) REFERENCES public.choferes(id) ON DELETE CASCADE;


--
-- Name: driver_shift_assignments FK_driver_shift_assignments_shift; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_shift_assignments
    ADD CONSTRAINT "FK_driver_shift_assignments_shift" FOREIGN KEY (shift_id) REFERENCES public.driver_shifts(id) ON DELETE CASCADE;


--
-- Name: driver_shifts FK_driver_shifts_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_shifts
    ADD CONSTRAINT "FK_driver_shifts_created_by" FOREIGN KEY (created_by_user_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: empleada_fotos_exclusivas FK_empleada_fotos_exclusivas_empleada_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empleada_fotos_exclusivas
    ADD CONSTRAINT "FK_empleada_fotos_exclusivas_empleada_id" FOREIGN KEY (empleada_id) REFERENCES public.empleadas(id) ON DELETE CASCADE;


--
-- Name: empleadas FK_empleadas_jefe_secundario; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.empleadas
    ADD CONSTRAINT "FK_empleadas_jefe_secundario" FOREIGN KEY (jefe_secundario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: employee_cash_obligations FK_employee_cash_obligations_service; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_cash_obligations
    ADD CONSTRAINT "FK_employee_cash_obligations_service" FOREIGN KEY (service_id) REFERENCES public.servicios(id) ON DELETE SET NULL;


--
-- Name: employee_cash_payments FK_employee_cash_payments_reverted_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_cash_payments
    ADD CONSTRAINT "FK_employee_cash_payments_reverted_by" FOREIGN KEY (reverted_by_user_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: employee_rating_snapshots FK_employee_rating_snapshots_employee; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_rating_snapshots
    ADD CONSTRAINT "FK_employee_rating_snapshots_employee" FOREIGN KEY (employee_id) REFERENCES public.empleadas(id) ON DELETE CASCADE;


--
-- Name: employee_report_history FK_employee_report_history_actor; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_report_history
    ADD CONSTRAINT "FK_employee_report_history_actor" FOREIGN KEY (actor_user_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: employee_report_history FK_employee_report_history_report; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_report_history
    ADD CONSTRAINT "FK_employee_report_history_report" FOREIGN KEY (report_id) REFERENCES public.employee_reports(id) ON DELETE CASCADE;


--
-- Name: employee_reports FK_employee_reports_admin; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_reports
    ADD CONSTRAINT "FK_employee_reports_admin" FOREIGN KEY (assigned_admin_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: employee_reports FK_employee_reports_boss; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_reports
    ADD CONSTRAINT "FK_employee_reports_boss" FOREIGN KEY (boss_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: employee_reports FK_employee_reports_client; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_reports
    ADD CONSTRAINT "FK_employee_reports_client" FOREIGN KEY (client_id) REFERENCES public.clientes(id) ON DELETE RESTRICT;


--
-- Name: employee_reports FK_employee_reports_driver; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_reports
    ADD CONSTRAINT "FK_employee_reports_driver" FOREIGN KEY (driver_id) REFERENCES public.choferes(id) ON DELETE RESTRICT;


--
-- Name: employee_reports FK_employee_reports_employee; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_reports
    ADD CONSTRAINT "FK_employee_reports_employee" FOREIGN KEY (employee_id) REFERENCES public.empleadas(id) ON DELETE RESTRICT;


--
-- Name: employee_reports FK_employee_reports_service; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_reports
    ADD CONSTRAINT "FK_employee_reports_service" FOREIGN KEY (service_id) REFERENCES public.servicios(id) ON DELETE SET NULL;


--
-- Name: viajes FK_f277fcfb42bf3b6a67bb0281e7b; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.viajes
    ADD CONSTRAINT "FK_f277fcfb42bf3b6a67bb0281e7b" FOREIGN KEY (chofer_id) REFERENCES public.choferes(id) ON DELETE RESTRICT;


--
-- Name: alertas_clientes FK_f8586d2454996457576bb522000; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alertas_clientes
    ADD CONSTRAINT "FK_f8586d2454996457576bb522000" FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE CASCADE;


--
-- Name: interaction_ratings FK_interaction_ratings_client; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_ratings
    ADD CONSTRAINT "FK_interaction_ratings_client" FOREIGN KEY (client_id) REFERENCES public.clientes(id) ON DELETE RESTRICT;


--
-- Name: interaction_ratings FK_interaction_ratings_driver; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_ratings
    ADD CONSTRAINT "FK_interaction_ratings_driver" FOREIGN KEY (driver_id) REFERENCES public.choferes(id) ON DELETE RESTRICT;


--
-- Name: interaction_ratings FK_interaction_ratings_employee; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_ratings
    ADD CONSTRAINT "FK_interaction_ratings_employee" FOREIGN KEY (employee_id) REFERENCES public.empleadas(id) ON DELETE RESTRICT;


--
-- Name: interaction_ratings FK_interaction_ratings_service; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_ratings
    ADD CONSTRAINT "FK_interaction_ratings_service" FOREIGN KEY (service_id) REFERENCES public.servicios(id) ON DELETE SET NULL;


--
-- Name: interaction_ratings FK_interaction_ratings_trip; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_ratings
    ADD CONSTRAINT "FK_interaction_ratings_trip" FOREIGN KEY (trip_id) REFERENCES public.viajes(id) ON DELETE SET NULL;


--
-- Name: liquidation_audit_log FK_liquidation_audit_actor; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.liquidation_audit_log
    ADD CONSTRAINT "FK_liquidation_audit_actor" FOREIGN KEY (actor_user_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: liquidation_debts FK_liquidation_debts_actor; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.liquidation_debts
    ADD CONSTRAINT "FK_liquidation_debts_actor" FOREIGN KEY (created_by_user_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: liquidation_debts FK_liquidation_debts_employee; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.liquidation_debts
    ADD CONSTRAINT "FK_liquidation_debts_employee" FOREIGN KEY (employee_id) REFERENCES public.empleadas(id) ON DELETE RESTRICT;


--
-- Name: liquidation_payments FK_liquidation_payments_actor; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.liquidation_payments
    ADD CONSTRAINT "FK_liquidation_payments_actor" FOREIGN KEY (created_by_user_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: liquidation_payments FK_liquidation_payments_debt; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.liquidation_payments
    ADD CONSTRAINT "FK_liquidation_payments_debt" FOREIGN KEY (debt_id) REFERENCES public.liquidation_debts(id) ON DELETE RESTRICT;


--
-- Name: liquidation_records FK_liquidation_records_actor; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.liquidation_records
    ADD CONSTRAINT "FK_liquidation_records_actor" FOREIGN KEY (registered_by_user_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: liquidation_records FK_liquidation_records_employee; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.liquidation_records
    ADD CONSTRAINT "FK_liquidation_records_employee" FOREIGN KEY (employee_id) REFERENCES public.empleadas(id) ON DELETE RESTRICT;


--
-- Name: liquidation_records FK_liquidation_records_service; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.liquidation_records
    ADD CONSTRAINT "FK_liquidation_records_service" FOREIGN KEY (service_id) REFERENCES public.servicios(id) ON DELETE SET NULL;


--
-- Name: payment_receipt_validations FK_payment_receipt_validations_jefe_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_receipt_validations
    ADD CONSTRAINT "FK_payment_receipt_validations_jefe_id" FOREIGN KEY (jefe_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: payment_receipt_validations FK_payment_receipt_validations_revisado_por_user_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_receipt_validations
    ADD CONSTRAINT "FK_payment_receipt_validations_revisado_por_user_id" FOREIGN KEY (revisado_por_user_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: payment_receipt_validations FK_payment_receipt_validations_servicio_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_receipt_validations
    ADD CONSTRAINT "FK_payment_receipt_validations_servicio_id" FOREIGN KEY (servicio_id) REFERENCES public.servicios(id) ON DELETE SET NULL;


--
-- Name: servicios FK_servicios_cancelado_por_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicios
    ADD CONSTRAINT "FK_servicios_cancelado_por_user" FOREIGN KEY (cancelado_por_user_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: solicitudes_servicio_manual FK_solicitud_manual_cliente; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitudes_servicio_manual
    ADD CONSTRAINT "FK_solicitud_manual_cliente" FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE SET NULL;


--
-- Name: solicitudes_servicio_manual FK_solicitud_manual_empleada; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitudes_servicio_manual
    ADD CONSTRAINT "FK_solicitud_manual_empleada" FOREIGN KEY (empleada_id) REFERENCES public.empleadas(id) ON DELETE CASCADE;


--
-- Name: solicitudes_servicio_manual FK_solicitud_manual_jefe; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitudes_servicio_manual
    ADD CONSTRAINT "FK_solicitud_manual_jefe" FOREIGN KEY (jefe_id) REFERENCES public.usuarios(id);


--
-- Name: solicitudes_servicio_manual FK_solicitud_manual_servicio; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitudes_servicio_manual
    ADD CONSTRAINT "FK_solicitud_manual_servicio" FOREIGN KEY (servicio_id) REFERENCES public.servicios(id) ON DELETE SET NULL;


--
-- Name: user_preferences FK_user_preferences_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT "FK_user_preferences_user" FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: viajes FK_viajes_driver_settlement; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.viajes
    ADD CONSTRAINT "FK_viajes_driver_settlement" FOREIGN KEY (driver_settlement_id) REFERENCES public.driver_settlements(id) ON DELETE RESTRICT;


--
-- Name: weekly_content_schedules FK_weekly_content_schedules_empleada_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_content_schedules
    ADD CONSTRAINT "FK_weekly_content_schedules_empleada_id" FOREIGN KEY (empleada_id) REFERENCES public.empleadas(id) ON DELETE CASCADE;


--
-- Name: weekly_photo_submissions FK_weekly_photo_submissions_empleada_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_photo_submissions
    ADD CONSTRAINT "FK_weekly_photo_submissions_empleada_id" FOREIGN KEY (empleada_id) REFERENCES public.empleadas(id) ON DELETE CASCADE;


--
-- Name: weekly_photo_submissions FK_weekly_photo_submissions_revisado_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_photo_submissions
    ADD CONSTRAINT "FK_weekly_photo_submissions_revisado_user" FOREIGN KEY (revisado_por_user_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: driver_settlements driver_settlements_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_settlements
    ADD CONSTRAINT driver_settlements_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.choferes(id) ON DELETE RESTRICT;


--
-- Name: driver_settlements driver_settlements_paid_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_settlements
    ADD CONSTRAINT driver_settlements_paid_by_user_id_fkey FOREIGN KEY (paid_by_user_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: employee_cash_obligations employee_cash_obligations_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_cash_obligations
    ADD CONSTRAINT employee_cash_obligations_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.empleadas(id) ON DELETE RESTRICT;


--
-- Name: employee_cash_payment_allocations employee_cash_payment_allocations_obligation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_cash_payment_allocations
    ADD CONSTRAINT employee_cash_payment_allocations_obligation_id_fkey FOREIGN KEY (obligation_id) REFERENCES public.employee_cash_obligations(id) ON DELETE RESTRICT;


--
-- Name: employee_cash_payment_allocations employee_cash_payment_allocations_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_cash_payment_allocations
    ADD CONSTRAINT employee_cash_payment_allocations_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.employee_cash_payments(id) ON DELETE CASCADE;


--
-- Name: employee_cash_payments employee_cash_payments_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_cash_payments
    ADD CONSTRAINT employee_cash_payments_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.empleadas(id) ON DELETE RESTRICT;


--
-- Name: employee_cash_payments employee_cash_payments_registered_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_cash_payments
    ADD CONSTRAINT employee_cash_payments_registered_by_user_id_fkey FOREIGN KEY (registered_by_user_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: employee_weekly_settlements employee_weekly_settlements_confirmed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_weekly_settlements
    ADD CONSTRAINT employee_weekly_settlements_confirmed_by_user_id_fkey FOREIGN KEY (confirmed_by_user_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: employee_weekly_settlements employee_weekly_settlements_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_weekly_settlements
    ADD CONSTRAINT employee_weekly_settlements_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.empleadas(id) ON DELETE RESTRICT;


--
-- Name: extras_servicio extras_servicio_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.extras_servicio
    ADD CONSTRAINT extras_servicio_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.service_participants(id) ON DELETE SET NULL;


--
-- Name: clientes fk_clientes_usuario; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT fk_clientes_usuario FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: conversations fk_conversations_booking_session; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT fk_conversations_booking_session FOREIGN KEY (booking_session_id) REFERENCES public.customer_booking_sessions(id) ON DELETE SET NULL;


--
-- Name: conversations fk_conversations_client; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT fk_conversations_client FOREIGN KEY (client_id) REFERENCES public.clientes(id) ON DELETE CASCADE;


--
-- Name: conversations fk_conversations_employee; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT fk_conversations_employee FOREIGN KEY (employee_id) REFERENCES public.empleadas(id) ON DELETE RESTRICT;


--
-- Name: conversations fk_conversations_human_owner; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT fk_conversations_human_owner FOREIGN KEY (human_owner_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: conversations fk_conversations_service; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT fk_conversations_service FOREIGN KEY (service_id) REFERENCES public.servicios(id) ON DELETE SET NULL;


--
-- Name: employee_onboardings fk_employee_onboardings_employee; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_onboardings
    ADD CONSTRAINT fk_employee_onboardings_employee FOREIGN KEY (employee_id) REFERENCES public.empleadas(id) ON DELETE SET NULL;


--
-- Name: employee_onboardings fk_employee_onboardings_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_onboardings
    ADD CONSTRAINT fk_employee_onboardings_user FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: group_service_requests fk_group_requests_conversation; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_service_requests
    ADD CONSTRAINT fk_group_requests_conversation FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;


--
-- Name: messages fk_messages_conversation; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: messages fk_messages_receipt_validation; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT fk_messages_receipt_validation FOREIGN KEY (receipt_validation_id) REFERENCES public.payment_receipt_validations(id) ON DELETE SET NULL;


--
-- Name: post_likes fk_post_likes_client; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_likes
    ADD CONSTRAINT fk_post_likes_client FOREIGN KEY (client_id) REFERENCES public.clientes(id) ON DELETE CASCADE;


--
-- Name: post_likes fk_post_likes_post; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_likes
    ADD CONSTRAINT fk_post_likes_post FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: post_media fk_post_media_post; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_media
    ADD CONSTRAINT fk_post_media_post FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: posts fk_posts_author_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT fk_posts_author_user FOREIGN KEY (author_user_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: posts fk_posts_employee; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT fk_posts_employee FOREIGN KEY (employee_id) REFERENCES public.empleadas(id) ON DELETE RESTRICT;


--
-- Name: posts fk_posts_reviewed_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT fk_posts_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: questionnaire_answers fk_questionnaire_answers_attempt; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questionnaire_answers
    ADD CONSTRAINT fk_questionnaire_answers_attempt FOREIGN KEY (attempt_id) REFERENCES public.questionnaire_attempts(id) ON DELETE CASCADE;


--
-- Name: questionnaire_answers fk_questionnaire_answers_option; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questionnaire_answers
    ADD CONSTRAINT fk_questionnaire_answers_option FOREIGN KEY (option_id) REFERENCES public.regulation_options(id) ON DELETE RESTRICT;


--
-- Name: questionnaire_answers fk_questionnaire_answers_question; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questionnaire_answers
    ADD CONSTRAINT fk_questionnaire_answers_question FOREIGN KEY (question_id) REFERENCES public.regulation_questions(id) ON DELETE RESTRICT;


--
-- Name: questionnaire_attempts fk_questionnaire_attempts_onboarding; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questionnaire_attempts
    ADD CONSTRAINT fk_questionnaire_attempts_onboarding FOREIGN KEY (onboarding_id) REFERENCES public.employee_onboardings(id) ON DELETE CASCADE;


--
-- Name: regulation_options fk_regulation_options_question; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regulation_options
    ADD CONSTRAINT fk_regulation_options_question FOREIGN KEY (question_id) REFERENCES public.regulation_questions(id) ON DELETE CASCADE;


--
-- Name: regulation_questions fk_regulation_questions_regulation; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regulation_questions
    ADD CONSTRAINT fk_regulation_questions_regulation FOREIGN KEY (regulation_id) REFERENCES public.employee_regulations(id) ON DELETE CASCADE;


--
-- Name: verificaciones_correo fk_verificaciones_correo_usuario; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verificaciones_correo
    ADD CONSTRAINT fk_verificaciones_correo_usuario FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: group_service_request_selections group_service_request_selections_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_service_request_selections
    ADD CONSTRAINT group_service_request_selections_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.empleadas(id) ON DELETE RESTRICT;


--
-- Name: group_service_request_selections group_service_request_selections_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_service_request_selections
    ADD CONSTRAINT group_service_request_selections_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.group_service_requests(id) ON DELETE CASCADE;


--
-- Name: group_service_requests group_service_requests_boss_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_service_requests
    ADD CONSTRAINT group_service_requests_boss_id_fkey FOREIGN KEY (boss_id) REFERENCES public.usuarios(id) ON DELETE RESTRICT;


--
-- Name: group_service_requests group_service_requests_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_service_requests
    ADD CONSTRAINT group_service_requests_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clientes(id) ON DELETE RESTRICT;


--
-- Name: group_service_requests group_service_requests_initial_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_service_requests
    ADD CONSTRAINT group_service_requests_initial_employee_id_fkey FOREIGN KEY (initial_employee_id) REFERENCES public.empleadas(id) ON DELETE SET NULL;


--
-- Name: group_service_requests group_service_requests_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_service_requests
    ADD CONSTRAINT group_service_requests_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.servicios(id) ON DELETE SET NULL;


--
-- Name: liquidation_settings liquidation_settings_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.liquidation_settings
    ADD CONSTRAINT liquidation_settings_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: mensajes_equipo mensajes_equipo_autor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mensajes_equipo
    ADD CONSTRAINT mensajes_equipo_autor_fkey FOREIGN KEY (autor_user_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: mensajes_equipo mensajes_equipo_empleada_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mensajes_equipo
    ADD CONSTRAINT mensajes_equipo_empleada_fkey FOREIGN KEY (empleada_id) REFERENCES public.empleadas(id) ON DELETE CASCADE;


--
-- Name: push_notification_events push_notification_events_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_notification_events
    ADD CONSTRAINT push_notification_events_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: service_group_audit service_group_audit_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_group_audit
    ADD CONSTRAINT service_group_audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: service_group_audit service_group_audit_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_group_audit
    ADD CONSTRAINT service_group_audit_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.group_service_requests(id) ON DELETE CASCADE;


--
-- Name: service_group_audit service_group_audit_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_group_audit
    ADD CONSTRAINT service_group_audit_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.servicios(id) ON DELETE CASCADE;


--
-- Name: service_operation_events service_operation_events_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_operation_events
    ADD CONSTRAINT service_operation_events_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.servicios(id) ON DELETE CASCADE;


--
-- Name: service_participants service_participants_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_participants
    ADD CONSTRAINT service_participants_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.empleadas(id) ON DELETE RESTRICT;


--
-- Name: service_participants service_participants_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_participants
    ADD CONSTRAINT service_participants_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.servicios(id) ON DELETE CASCADE;


--
-- Name: service_payments service_payments_approved_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_payments
    ADD CONSTRAINT service_payments_approved_by_user_id_fkey FOREIGN KEY (approved_by_user_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: service_payments service_payments_receipt_validation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_payments
    ADD CONSTRAINT service_payments_receipt_validation_id_fkey FOREIGN KEY (receipt_validation_id) REFERENCES public.payment_receipt_validations(id) ON DELETE SET NULL;


--
-- Name: service_payments service_payments_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_payments
    ADD CONSTRAINT service_payments_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.servicios(id) ON DELETE CASCADE;


--
-- Name: servicios servicios_administrative_void_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicios
    ADD CONSTRAINT servicios_administrative_void_by_user_id_fkey FOREIGN KEY (administrative_void_by_user_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: servicios servicios_deleted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicios
    ADD CONSTRAINT servicios_deleted_by_user_id_fkey FOREIGN KEY (deleted_by_user_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: servicios servicios_preset_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicios
    ADD CONSTRAINT servicios_preset_location_id_fkey FOREIGN KEY (preset_location_id) REFERENCES public.preset_service_locations(id) ON DELETE SET NULL;


--
-- Name: servicios servicios_servicio_previo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.servicios
    ADD CONSTRAINT servicios_servicio_previo_id_fkey FOREIGN KEY (servicio_previo_id) REFERENCES public.servicios(id) ON DELETE SET NULL;


--
-- Name: transport_settings transport_settings_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transport_settings
    ADD CONSTRAINT transport_settings_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- Name: trip_passengers trip_passengers_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_passengers
    ADD CONSTRAINT trip_passengers_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.empleadas(id) ON DELETE RESTRICT;


--
-- Name: trip_passengers trip_passengers_trip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trip_passengers
    ADD CONSTRAINT trip_passengers_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.viajes(id) ON DELETE CASCADE;


--
-- Name: viajes viajes_fare_confirmed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.viajes
    ADD CONSTRAINT viajes_fare_confirmed_by_user_id_fkey FOREIGN KEY (fare_confirmed_by_user_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--
`;

const DATOS_SQL = String.raw`
--
-- PostgreSQL database dump
--


-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14


--
-- Data for Name: employee_regulations; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.employee_regulations (id, title, content, passing_score, publication_key, published_at, updated_at, target_role) VALUES ('00000000-0000-4000-8000-000000001000', 'Reglamento básico de trabajo', '1. Mantén una higiene adecuada: lávate las manos, usa uniforme limpio y lleva el cabello recogido antes de manipular alimentos.

2. Evita la contaminación cruzada: separa ingredientes crudos, productos terminados, utensilios y superficies de trabajo.

3. Respeta las recetas y medidas establecidas. No cambies ingredientes, cantidades, temperaturas o tiempos sin autorización.

4. Usa correctamente el equipo de trabajo. Reporta inmediatamente cualquier accidente, desperfecto o situación insegura.

5. Sé puntual, mantén limpia y ordenada tu área y trata con respeto a clientes y compañeros.', 80, '00000000-0000-4000-8000-000000002000', '2026-11-23 00:22:32.638533+00', '2026-11-23 00:22:32.638533+00', 'empleada');
INSERT INTO public.employee_regulations (id, title, content, passing_score, publication_key, published_at, updated_at, target_role) VALUES ('00000000-0000-4000-8000-000000003000', 'Reglamento y Responsabilidades', 'Reglamento y Responsabilidades

1. Presentación Personal
* Estar siempre preparada para un servicio y llevar todo lo necesario: Blazer, Tacones, Lencería, Echarpe (si aplica), Traje de baño, Condones, Lencería extra.
* Mantener una excelente imagen personal en todo momento: vestimenta, cabello, uñas, higiene y presentación.
* Durante el horario laboral debes estar completamente disponible, con tu imagen al 100% y tu equipo de trabajo listo.

2. Herramientas de Trabajo
* Mantener el celular con datos móviles y suficiente batería.
* Cuidar y mantener en perfecto estado todas tus herramientas de trabajo.
* Eres responsable de tener listas todas tus herramientas antes de cada servicio.
* Cuando se te solicite un Uber para transportarte, deberás llevar efectivo y cambio suficiente.

3. Puntualidad y Reportes
* Avisar en tiempo real: Al llegar al servicio, Al finalizar el servicio, Cuando estés con el chofer, Cuando llegues a casa.
* Los domingos debes estar lista sin excepción a las 6:00 p.m.
* Administra correctamente tus tiempos para comidas, descanso e imagen personal.
* No está permitido dormirse durante el horario de trabajo.

4. Servicios
* Al llegar a un servicio, siempre deberás cobrar por adelantado.
* Cumplir con la duración completa del servicio contratado.
* Ofrecer siempre el mejor servicio posible.
* Recuerda que representas tanto tu imagen como la de la agencia.
* Al finalizar cada servicio, subir correctamente la información al sistema junto con su comprobante de pago.
* Si consigues un servicio por tu cuenta, deberás proporcionar la información correspondiente y compartir el número del cliente.
* Ningún cliente está autorizado para llevarte a tu domicilio.
* Muchas veces se toman servicios por $2,300 MXN y, en algunos casos de varias horas, por $2,000 MXN; cualquier situación relacionada deberá consultarse con la oficina.

5. Respeto y Conducta
* Dar el mismo respeto que recibes.
* Respetar jerarquías y rangos dentro de la empresa.
* Respetar a telefonistas, compañeras y choferes.
* Cualquier problema con la oficina debe resolverse de manera inmediata y por los canales correspondientes.
* No tomar ninguna decisión relacionada con el trabajo sin consultarlo previamente con la oficina.
* No está permitido hablar sobre la logística, procesos internos, códigos o información confidencial de la empresa.
* No mostrar ni compartir información relacionada con el trabajo.

6. Permisos y Salidas
* Los permisos se solicitan únicamente de lunes a miércoles dentro del horario establecido.
* No salir de las instalaciones o domicilio asignado sin autorización previa de tu telefonista.

7. Transporte
* Es importante pagar a los choferes de la agencia inmediatamente la cantidad correspondiente al traslado realizado.
* Ningún cliente podrá transportarte a tu domicilio bajo ninguna circunstancia.
* Cuando un chofer llegue por ti, deberás estar completamente lista para salir.
* Una vez que el chofer informe su llegada, tendrás un máximo de 5 minutos para abordar la unidad.
* Los retrasos injustificados que afecten la operación o generen tiempos de espera excesivos podrán considerarse una falta administrativa.

8. Salud y Bienestar
* Si en cualquier momento te sientes indispuesta o presentas algún problema de salud, deberás informarlo inmediatamente a la oficina.
* No esperes a que se te asigne un servicio para comunicar tu situación.
* La oficina debe estar informada en tiempo real para tomar las medidas correspondientes.

9. Normas de la Casa
* Respetar las reglas de la casa.
* Mantener las áreas limpias.
* Limpiar cualquier espacio o material que utilices.
* No está permitido permanecer en una casa que no sea la asignada.
* Procurar no entrar con tacones a las casas para respetar a vecinos y personas con quienes compartes el hogar.

10. Uso de Grupos de Comunicación
* El grupo de tu casa tiene como finalidad: Avisar entradas y salidas, Reportar la llegada de Uber o transporte, Informar cualquier daño o incidente.
* Utilizar los grupos únicamente para los fines establecidos.

11. Contenido y Promoción
* Enviar contenido todos los lunes.
* Mínimo 7 fotografías por semana.

12. Sustancias y Comportamiento con Clientes
* Está estrictamente prohibido solicitar sustancias a los clientes si ellos no las han pedido, ofrecido o mencionado previamente.
* Mantener siempre una conducta profesional y respetuosa.

13. Responsabilidad General
* No realizar paradas innecesarias durante el trayecto hacia un servicio.
* Ser responsable en todo momento de tu puntualidad, presentación y desempeño laboral.
* Cumplir con todas las normas y procedimientos establecidos por la empresa.

Sanciones
El incumplimiento de cualquiera de las reglas establecidas en este reglamento podrá generar una sanción económica. Las multas podrán ir desde $1,000 MXN hasta $10,000 MXN, dependiendo de la gravedad de la falta, las circunstancias del caso y la decisión de la oficina. Cada situación será evaluada individualmente y la administración determinará la sanción correspondiente.', 80, '00000000-0000-4000-8000-000000004000', '2026-11-23 00:22:33.348398+00', '2026-11-23 00:22:33.348398+00', 'empleada');


--
-- Data for Name: liquidation_settings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.liquidation_settings (id, card_extra_commission_percentage, card_extra_commission_threshold, updated_at, updated_by_user_id, weekly_content_fine_amount, weekly_content_max_reminders) VALUES (1, 15.00, 1000.00, '2026-11-23 00:22:34.38924+00', NULL, 300.00, 3);


--
-- Data for Name: regulation_questions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.regulation_questions (id, regulation_id, publication_key, text, display_order, group_key) VALUES ('00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000001000', '00000000-0000-4000-8000-000000002000', '¿Qué debes hacer antes de manipular alimentos?', 1, NULL);
INSERT INTO public.regulation_questions (id, regulation_id, publication_key, text, display_order, group_key) VALUES ('00000000-0000-4000-8000-000000001002', '00000000-0000-4000-8000-000000001000', '00000000-0000-4000-8000-000000002000', '¿Cómo se evita la contaminación cruzada?', 2, NULL);
INSERT INTO public.regulation_questions (id, regulation_id, publication_key, text, display_order, group_key) VALUES ('00000000-0000-4000-8000-000000001003', '00000000-0000-4000-8000-000000001000', '00000000-0000-4000-8000-000000002000', '¿Puedes cambiar una receta sin autorización?', 3, NULL);
INSERT INTO public.regulation_questions (id, regulation_id, publication_key, text, display_order, group_key) VALUES ('00000000-0000-4000-8000-000000001004', '00000000-0000-4000-8000-000000001000', '00000000-0000-4000-8000-000000002000', '¿Qué debes hacer si detectas un equipo dañado?', 4, NULL);
INSERT INTO public.regulation_questions (id, regulation_id, publication_key, text, display_order, group_key) VALUES ('00000000-0000-4000-8000-000000001005', '00000000-0000-4000-8000-000000001000', '00000000-0000-4000-8000-000000002000', '¿Cómo debe mantenerse el área de trabajo?', 5, NULL);
INSERT INTO public.regulation_questions (id, regulation_id, publication_key, text, display_order, group_key) VALUES ('00000000-0000-4000-8000-000000003001', '00000000-0000-4000-8000-000000003000', '00000000-0000-4000-8000-000000004000', '¿Qué debes hacer al llegar a un servicio con un cliente?', 1, NULL);
INSERT INTO public.regulation_questions (id, regulation_id, publication_key, text, display_order, group_key) VALUES ('00000000-0000-4000-8000-000000003002', '00000000-0000-4000-8000-000000003000', '00000000-0000-4000-8000-000000004000', '¿Cuál es el tiempo máximo de espera para abordar la unidad una vez que el chofer informa su llegada?', 2, NULL);
INSERT INTO public.regulation_questions (id, regulation_id, publication_key, text, display_order, group_key) VALUES ('00000000-0000-4000-8000-000000003003', '00000000-0000-4000-8000-000000003000', '00000000-0000-4000-8000-000000004000', '¿A qué hora debes estar lista los domingos sin excepción?', 3, NULL);
INSERT INTO public.regulation_questions (id, regulation_id, publication_key, text, display_order, group_key) VALUES ('00000000-0000-4000-8000-000000003004', '00000000-0000-4000-8000-000000003000', '00000000-0000-4000-8000-000000004000', '¿Cuál es la regla respecto a solicitar sustancias a los clientes?', 4, NULL);
INSERT INTO public.regulation_questions (id, regulation_id, publication_key, text, display_order, group_key) VALUES ('00000000-0000-4000-8000-000000003005', '00000000-0000-4000-8000-000000003000', '00000000-0000-4000-8000-000000004000', '¿Cuál de las siguientes acciones está permitida al finalizar un servicio?', 5, NULL);


--
-- Data for Name: regulation_options; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000001101', '00000000-0000-4000-8000-000000001001', 'Lavarte las manos y usar uniforme limpio.', true, 1);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000001102', '00000000-0000-4000-8000-000000001001', 'Revisar tu teléfono.', false, 2);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000001103', '00000000-0000-4000-8000-000000001001', 'Probar todos los ingredientes.', false, 3);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000001104', '00000000-0000-4000-8000-000000001002', 'Utilizando los mismos utensilios para todo.', false, 1);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000001105', '00000000-0000-4000-8000-000000001002', 'Separando ingredientes, productos y utensilios.', true, 2);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000001106', '00000000-0000-4000-8000-000000001002', 'Guardando todos los alimentos juntos.', false, 3);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000001107', '00000000-0000-4000-8000-000000001003', 'Sí, siempre que el cambio sea pequeño.', false, 1);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000001108', '00000000-0000-4000-8000-000000001003', 'Sí, cuando tengas prisa.', false, 2);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000001109', '00000000-0000-4000-8000-000000001003', 'No, deben respetarse las recetas y medidas establecidas.', true, 3);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000001110', '00000000-0000-4000-8000-000000001004', 'Continuar usándolo.', false, 1);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000001111', '00000000-0000-4000-8000-000000001004', 'Reportarlo inmediatamente.', true, 2);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000001112', '00000000-0000-4000-8000-000000001004', 'Guardarlo sin avisar.', false, 3);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000001113', '00000000-0000-4000-8000-000000001005', 'Limpia y ordenada.', true, 1);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000001114', '00000000-0000-4000-8000-000000001005', 'Solamente limpia al terminar la semana.', false, 2);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000001115', '00000000-0000-4000-8000-000000001005', 'Con todos los utensilios sobre la mesa.', false, 3);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000003101', '00000000-0000-4000-8000-000000003001', 'Cobrar el servicio por adelantado antes de iniciar.', true, 1);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000003102', '00000000-0000-4000-8000-000000003001', 'Esperar a que el cliente pregunte cuánto es al final.', false, 2);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000003103', '00000000-0000-4000-8000-000000003001', 'Cobrar la mitad al inicio y la mitad al finalizar.', false, 3);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000003104', '00000000-0000-4000-8000-000000003002', 'Un máximo de 5 minutos.', true, 1);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000003105', '00000000-0000-4000-8000-000000003002', '10 minutos.', false, 2);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000003106', '00000000-0000-4000-8000-000000003002', 'El tiempo que sea necesario hasta estar completamente lista.', false, 3);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000003107', '00000000-0000-4000-8000-000000003003', 'A las 6:00 p.m.', true, 1);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000003108', '00000000-0000-4000-8000-000000003003', 'A las 8:00 p.m.', false, 2);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000003109', '00000000-0000-4000-8000-000000003003', 'Depende del horario de mi primer servicio.', false, 3);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000003110', '00000000-0000-4000-8000-000000003004', 'Puedes pedirlas siempre que haya confianza con el cliente.', false, 1);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000003111', '00000000-0000-4000-8000-000000003004', 'Está estrictamente prohibido pedirlas si el cliente no las ha ofrecido o mencionado previamente.', true, 2);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000003112', '00000000-0000-4000-8000-000000003004', 'Solo puedes pedir alcohol, pero nada más.', false, 3);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000003113', '00000000-0000-4000-8000-000000003005', 'Subir correctamente la información al sistema junto con su comprobante de pago.', true, 1);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000003114', '00000000-0000-4000-8000-000000003005', 'Pedirle al cliente que te lleve a tu domicilio.', false, 2);
INSERT INTO public.regulation_options (id, question_id, text, is_correct, display_order) VALUES ('00000000-0000-4000-8000-000000003115', '00000000-0000-4000-8000-000000003005', 'Hablar sobre la logística y procesos internos de la agencia con el cliente.', false, 3);


--
-- Data for Name: transport_settings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.transport_settings (id, external_location_fee, updated_at, updated_by_user_id, coverage_city, coverage_center_lat, coverage_center_lng, coverage_radius_km) VALUES (1, 0.00, '2026-11-23 00:22:33.096949+00', NULL, 'Querétaro', 20.5888000, -100.3899000, 45.00);


--
-- PostgreSQL database dump complete
--
`;
