# Delegación Mac por tarea — Sandbox V3

El procedimiento vigente está en [deploy/task-scoped/README.md](../deploy/task-scoped/README.md).

En trusted, el agente inicia automáticamente una sesión con task_id y orígenes HTTPS exactos al comienzo de una tarea autorizada, reutiliza session_id en CDP/nativo y revoca al finalizar. La sesión tiene máximo 30 minutos y 200 acciones. Una acción sin sesión en trusted falla con TASK_SESSION_REQUIRED, sin mostrar el cuadro por clic. La ausencia de trusted conserva el consentimiento local anterior.

Los cambios requieren desplegar el paquete y actualizar el descubrimiento de herramientas. El código fuente no demuestra instalación macOS; ver el recibo del paquete y el estado real del bridge.

## Verificación macOS del 13 de noviembre de 2026

El payload 6025414 quedó instalado: task_delegation_version=1, configured_trust, máximo 30 minutos/200 acciones, unlimited_actions=false, política de orígenes preservada. El inicio real por Sandbox V3 con task_id/origins produjo audit_receipt=saved y se revocó explícitamente; estado final sin sesión activa. El splash nativo instalado usa portal verde animado, whoosh original y Liquid Glass regular con apariencia del sistema. Se verificaron Swift, pruebas macOS y paridad del controlador; los respaldos y recibos permanecen privados en CloudSandboxBackups. La supervisión local recupera únicamente el contenedor canónico existente, sin recrearlo desde Compose histórico ni tocar Chrome, Edge o dev-main.
