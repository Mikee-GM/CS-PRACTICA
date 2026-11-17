/**
 * Cuando una modelo es visible para los clientes: catalogo activo, usuario
 * activo y sin sancion vigente.
 *
 * Es un solo criterio para el chat web (`ConversationsService`, que no deja
 * abrir un chat con una modelo oculta) y el feed (`FeedService`, que no
 * muestra sus posts). Si cada uno lo copiara, una modelo sancionada podria
 * seguir publicando en el feed aunque ya no admita chats.
 *
 * `EmployeesService.findAllActive` (el catalogo publico) aplica el mismo
 * criterio en memoria, porque carga las entidades con fotos y extras; si el
 * criterio cambia aqui, hay que cambiarlo tambien alli.
 *
 * Son fragmentos de SQL crudo con los alias de la consulta que los incluye;
 * los alias los pone el codigo, nunca la entrada del usuario.
 */

/** Une la cuenta de la modelo; la condicion lee `activo` de ella. */
export function joinUsuarioDeModelo(empleada = 'e', usuario = 'u'): string {
  return `INNER JOIN usuarios ${usuario} ON ${usuario}.id = ${empleada}.usuario_id`;
}

/** Condicion para el WHERE; exige el JOIN de `joinUsuarioDeModelo`. */
export function condicionModeloVisible(empleada = 'e', usuario = 'u'): string {
  return `${empleada}.catalogo_activo = true
         AND ${usuario}.activo = true
         AND NOT EXISTS (
           SELECT 1 FROM disciplinary_sanctions s
           WHERE s.subject_type = 'employee'
             AND s.subject_id = ${empleada}.id
             AND s.status = 'active'
             AND s.starts_at <= now()
             AND (s.type = 'permanent_ban' OR s.ends_at > now()))`;
}
