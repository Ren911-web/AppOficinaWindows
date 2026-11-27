# Canal de actualizaciones de AppOficina

Este repositorio contiene la versión portable de Windows y el manifiesto de actualización.

Para publicar una actualización:

1. Incrementar `version` en `updates/latest.json`.
2. Generar el paquete portable como `AppOficinaWindows-<version>.zip` y publicarlo como GitHub Release.
3. Calcular su SHA-256 y colocarlo en `sha256`.
4. Subir ambos archivos al repositorio.

La aplicación comprobará el manifiesto antes de ofrecer una actualización y pedirá confirmación al usuario.

El manifiesto público se sirve desde `raw.githubusercontent.com` y el paquete se descarga desde el Release correspondiente. Cada paquete debe tener SHA-256 obligatorio.

