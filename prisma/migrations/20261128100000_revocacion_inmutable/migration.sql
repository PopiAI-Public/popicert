-- La revocación vive en status_entry: es lo que se publica, firmado, en
-- /status/<n>. El trigger de credential solo protegía su copia. Ahora también
-- aquí: una posición no cambia de lista ni de índice, una revocación no se
-- deshace y una entrada revocada no se borra. (Las que no se llegaron a usar
-- sí se pueden borrar: es lo que hace la emisión cuando no llega a guardar.)

CREATE FUNCTION status_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'popicert: una entrada de estado revocada no se borra';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.list_id IS DISTINCT FROM OLD.list_id
     OR NEW.index IS DISTINCT FROM OLD.index
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'popicert: una posición de la lista de estado no cambia';
  END IF;

  IF OLD.revoked_at IS NOT NULL
     AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
          OR NEW.revocation_reason IS DISTINCT FROM OLD.revocation_reason) THEN
    RAISE EXCEPTION 'popicert: una revocación no se deshace';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER status_entry_guard
  BEFORE UPDATE OR DELETE ON "status_entry"
  FOR EACH ROW EXECUTE FUNCTION status_entry_guard();

-- Una lista de estado tampoco cambia de número ni de tamaño, y su versión solo sube.
CREATE FUNCTION status_list_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'popicert: una lista de estado publicada no se borra';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.size IS DISTINCT FROM OLD.size OR NEW.purpose IS DISTINCT FROM OLD.purpose THEN
    RAISE EXCEPTION 'popicert: una lista de estado no cambia de número, tamaño ni propósito';
  END IF;
  IF NEW.version <= OLD.version THEN
    RAISE EXCEPTION 'popicert: la versión de una lista de estado solo sube';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER status_list_guard
  BEFORE UPDATE OR DELETE ON "status_list"
  FOR EACH ROW EXECUTE FUNCTION status_list_guard();
