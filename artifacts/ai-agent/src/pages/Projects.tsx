import { useState } from "react";
import { Link } from "wouter";
import {
  useListProjects,
  useCreateProject,
  useDeleteProject,
  getListProjectsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FolderGit2,
  Plus,
  Trash2,
  ChevronRight,
  FolderOpen,
} from "lucide-react";

const LANGUAGE_COLORS: Record<string, string> = {
  typescript: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  javascript: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  python: "bg-green-500/20 text-green-400 border-green-500/30",
  rust: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  go: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  java: "bg-red-500/20 text-red-400 border-red-500/30",
};

export function Projects() {
  const queryClient = useQueryClient();
  const { data: projects, isLoading } = useListProjects();
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", path: "", language: "", description: "" });

  function handleCreate() {
    if (!form.name || !form.path) return;
    createProject.mutate(
      {
        data: {
          name: form.name,
          path: form.path,
          language: form.language || null,
          description: form.description || null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          setOpen(false);
          setForm({ name: "", path: "", language: "", description: "" });
        },
      }
    );
  }

  function handleDelete(id: number, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    deleteProject.mutate(
      { id },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() }) }
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-mono tracking-tight">Projects</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your coding projects.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="font-mono">
              <Plus className="h-4 w-4 mr-2" />
              New Project
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle className="font-mono">Create Project</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-mono text-muted-foreground">Project Name</Label>
                <Input
                  placeholder="my-awesome-project"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-mono text-muted-foreground">Path</Label>
                <Input
                  placeholder="my-awesome-project"
                  value={form.path}
                  onChange={e => setForm(f => ({ ...f, path: e.target.value }))}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-mono text-muted-foreground">Language</Label>
                <Input
                  placeholder="typescript, python, rust..."
                  value={form.language}
                  onChange={e => setForm(f => ({ ...f, language: e.target.value }))}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-mono text-muted-foreground">Description</Label>
                <Input
                  placeholder="Optional description"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="font-mono"
                />
              </div>
              <Button
                className="w-full font-mono"
                onClick={handleCreate}
                disabled={!form.name || !form.path || createProject.isPending}
              >
                {createProject.isPending ? "Creating..." : "Create Project"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : !projects || projects.length === 0 ? (
        <Card className="border-dashed border-border bg-card/50">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FolderOpen className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground font-mono text-sm">No projects yet.</p>
            <p className="text-muted-foreground/60 font-mono text-xs mt-1">Create a project to get started.</p>
            <Button
              className="mt-6 font-mono"
              size="sm"
              onClick={() => setOpen(true)}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New Project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {projects.map(project => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="border-border/50 bg-card/50 hover:bg-card transition-colors cursor-pointer group">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="p-2.5 bg-primary/10 rounded-md border border-primary/20">
                    <FolderGit2 className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-sm truncate">{project.name}</span>
                      {project.language && (
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-mono px-1.5 py-0 ${LANGUAGE_COLORS[project.language.toLowerCase()] || "border-border"}`}
                        >
                          {project.language}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
                      {project.path}
                    </div>
                    {project.description && (
                      <div className="text-xs text-muted-foreground/70 mt-1 truncate">
                        {project.description}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={e => handleDelete(project.id, e)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
