const $ = (id) => document.getElementById(id);
async function refresh() {
  try {
    const res = await fetch("/api/projects");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    $("projects").replaceChildren();
    for (const project of data.projects) {
      const link = document.createElement("a");
      link.href = project.url;
      link.className = "project";
      const title = document.createElement("h3");
      title.textContent = project.title;
      const info = document.createElement("span");
      info.className = "project-duration";
      const seconds = Math.max(0, Math.round(project.duration));
      info.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
      link.append(title, info);
      $("projects").append(link);
    }
    $("library-status").textContent = data.projects.length
      ? ""
      : "Your videos will appear here after you import or record one.";
  } catch (error) {
    $("library-status").textContent = error.message;
  }
}
$("refresh").onclick = refresh;
$("video").onchange = () => {
  const file = $("video").files[0];
  $("file-name").textContent = file?.name ?? "Choose a video";
  $("file-name").title = file?.name ?? "";
  if (file && !$("title").value)
    $("title").placeholder = file.name.replace(/\.[^.]+$/, "");
};
$("import-form").onsubmit = async (event) => {
  event.preventDefault();
  const file = $("video").files[0];
  if (!file) return;
  $("import-status").hidden = false;
  if (file.size > 4 * 1024 ** 3) {
    $("import-status").textContent = "Choose a video smaller than 4 GB.";
    return;
  }
  $("import").disabled = true;
  $("import-status").textContent = "Preparing video…";
  try {
    const query = new URLSearchParams({
      filename: file.name,
      title: $("title").value,
    });
    const response = await fetch(`/api/import?${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    location.assign(result.url);
  } catch (error) {
    $("import-status").textContent = error.message;
    $("import").disabled = false;
    await refresh();
  }
};
await refresh();
