import { useState } from "react";
import {
  useGetMemory,
  useAddMemory,
  useDeleteMemory,
  useListProjects,
  getGetMemoryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  BrainCircuit,
  Plus,
  Trash2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const MEMORY_TYPES = [
  "project_structure",
  "known_bug",
  "past_fix",
  "important_file",
  "error_pattern",
  "general",
];

const TYPE_COLORS: Record<string, string> = {
  project_structure: "text-blue-400 border-blue-500/30 bg-blue-500/10",
  known_bug: "text-red-400 border-red-500/30 bg-red-500/10",
  past_fix: "text-green-400 border-green-500/30 bg-green-500/10",
  important_file: "text-yellow-400 border-yellow-500/30 bg-yellow-500/10",
  error_pattern: "text-orange-400 border-orange-500/30 bg-orange-500/10",
  general: "text-muted-foreground border-muted-foreground/30 bg-muted/20",
};

export function Memory() {
  const queryClient = useQueryClient();
  const { data: memory, isLoading } = useGetMemory();
  const { data: projects } = useListProjects();
  const addMemory = useAddMemory();
  const deleteMemory = useDeleteMemory();

  const [open, setOpen] = useState(false);
  const [filterType, setFilterType] = useState("all");
  const [form, setForm] = useState({
    type: "general",
    key: "",
    value: "",
    projectId: "",
  });

  const filtered = memory?.filter(m => filterType === "all" || m.type === filterType) || [];

  function handleAdd() {
    if (!form.key || !form.value) return;
    addMemory.mutate(
      {
        data: {
          type: form.type as "project_structure" | "known_bug" | "past_fix" | "important_file" | "error_pattern" | "general",
          key: form.key,
          value: form.value,
          projectId: form.projectId ? parseInt(form.projectId) : null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMemoryQueryKey() });
          setOpen(false);
          setForm({ type: "general", key: "", value: "", projectId: "" });
        },
      }
    );
  }

  function handleDelete(id: number) {
    deleteMemory.mutate(
      { id },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetMemoryQueryKey() }) }
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-mono tracking-tight">Memory</h1>
          <p className="text-muted-foreground text-sm mt-1">Agent long-term memory and knowledge base.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="font-mono">
              <Plus className="h-4 w-4 mr-2" />
              Add Memory
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle className="font-mono">Add Memory Entry</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-mono text-muted-foreground">Type</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger className="font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MEMORY_TYPES.map(t => (
                      <SelectItem key={t} value={t} className="font-mono">{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-mono text-muted-foreground">Key</Label>
                <Input
                  placeholder="e.g. main_entry_file"
                  value={form.key}
                  onChange={e => setForm(f => ({ ...f, key: e.target.value }))}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-mono text-muted-foreground">Value</Label>
                <Textarea
                  placeholder="The knowledge to remember..."
                  value={form.value}
                  onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                  className="font-mono text-xs min-h-20"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-mono text-muted-foreground">Project (optional)</Label>
                <Select value={form.projectId} onValueChange={v => setForm(f => ({ ...f, projectId: v }))}>
                  <SelectTrigger className="font-mono">
                    <SelectValue placeholder="Global memory" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="" className="font-mono">Global memory</SelectItem>
                    {projects?.map(p => (
                      <SelectItem key={p.id} value={String(p.id)} className="font-mono">{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="w-full font-mono"
                onClick={handleAdd}
                disabled={!form.key || !form.value || addMemory.isPending}
              >
                {addMemory.isPending ? "Adding..." : "Add Memory"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-2 flex-wrap">
        {["all", ...MEMORY_TYPES].map(t => (
          <Button
            key={t}
            variant={filterType === t ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs font-mono"
            onClick={() => setFilterType(t)}
          >
            {t}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed border-border bg-card/50">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <BrainCircuit className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground font-mono text-sm">No memory entries.</p>
            <p className="text-muted-foreground/60 font-mono text-xs mt-1">
              The agent stores knowledge here as it works.
            </p>
            <Button className="mt-6 font-mono" size="sm" onClick={() => setOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Memory
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map(entry => (
            <Card key={entry.id} className="border-border/50 bg-card/50 group">
              <CardContent className="p-4 flex gap-4">
                <Badge
                  variant="outline"
                  className={`text-[10px] font-mono px-1.5 py-0 h-fit flex-shrink-0 ${TYPE_COLORS[entry.type] || TYPE_COLORS.general}`}
                >
                  {entry.type.replace("_", " ")}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-sm font-semibold text-foreground/90">{entry.key}</div>
                  <div className="text-xs text-muted-foreground font-mono mt-1 break-words">{entry.value}</div>
                  <div className="text-[10px] text-muted-foreground/50 font-mono mt-1.5">
                    {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => handleDelete(entry.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
