/* Household settings. In the public package every value is a placeholder: the installer
   (Apps2Samsung's form, or a coding agent following AGENTS.md) replaces them, or the app asks on
   first start. Values are taken literally. Placeholders left as they are count as empty.
   Several servers: separate them with commas. Keep the double quotes: installers escape for them. */
window.LOCAL_CONFIG = {
    xtream: {
        servers: "__OCTV_SERVER__",
        user: "__OCTV_USER__",
        pass: "__OCTV_PASS__",
        streamServers: "__OCTV_BACKUPS__"
    }
};
