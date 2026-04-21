import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  useGetProject,
  useListFiles,
  useReadFile,
  useExecuteCommand,
  useRunTests,
  useGitInit,
  useGitCommit,
  getListFilesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FolderGit2,
  File,
  Folder,
  ChevronRight,
  Terminal,
  Play,
  GitBranch,
  GitCommit,
  ArrowLeft,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

type FileNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number | null;
  children: FileNode[] | null;
};

function FileTree({
  nodes,
  onSelect,
  selectedPath,
  depth = 0,
}: {
  nodes: FileNode[];
  onSelect: (path: string) => void;
  selectedPath: string | null;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(path: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }

  return (
    <div>
      {nodes.map(node => (
        <div key={node.path}>
          <div
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-sm cursor-pointer text-xs font-mono hover:bg-secondary/50 transition-colors",
              selectedPath === node.path && node.type === "file" && "bg-primary/10 text-primary",
            )}
            style={{ paddingLeft: `${8 + depth * 16}px` }}
            onClick={() => {
              if (node.type === "directory") toggle(node.path);
              else onSelect(node.path);
            }}
          >
            {node.type === "directory" ? (
              <>
                <ChevronRight
                  className={cn("h-3 w-3 text-muted-foreground transition-transform", expanded.has(node.path) && "rotate-90")}
                />
                <Folder className="h-3 w-3 text-yellow-500/80" />
              </>
            ) : (
              <>
                <span className="w-3" />
                <File className="h-3 w-3 text-muted-foreground" />
              </>
            )}
            <span className="truncate">{node.name}</span>
          </div>
          {node.type === "directory" && expanded.has(node.path) && node.children && (
            <FileTree
              nodes={node.children}
              onSelect={onSelect}
              selectedPath={selectedPath}
              depth={depth + 1}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id, 10);
  const queryClient = useQueryClient();

  const { data: project, isLoading: projectLoading } = useGetProject(projectId);
  const { data: files, isLoading: filesLoading, refetch: refetchFiles } = useListFiles(projectId);

  const readFile = useReadFile();
  const executeCommand = useExecuteCommand();
  const runTests = useRunTests();
  const gitInit = useGitInit();
  const gitCommit = useGitCommit();

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [cmdInput, setCmdInput] = useState("");
  const [cmdOutput, setCmdOutput] = useState<Array<{ cmd: string; output: string; success: boolean }>>([]);
  const [commitMsg, setCommitMsg] = useState("");

  function selectFile(path: string) {
    setSelectedFile(path);
    readFile.mutate(
      { id: projectId, data: { path } },
      { onSuccess: (data) => setFileContent(data.content) }
    );
  }

  function runCommand() {
    if (!cmdInput.trim()) return;
    const cmd = cmdInput;
    setCmdInput("");
    executeCommand.mutate(
      { id: projectId, data: { command: cmd } },
      {
        onSuccess: (result) => {
          setCmdOutput(prev => [...prev, {
            cmd,
            output: result.stdout + result.stderr,
            success: result.success,
          }]);
        },
      }
    );
  }

  if (projectLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground font-mono">Project not found.</p>
        <Link href="/projects">
          <Button variant="ghost" size="sm" className="mt-4 font-mono">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Projects
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="h-12 border-b border-border px-6 flex items-center justify-between bg-card/50">
        <div className="flex items-center gap-3">
          <Link href="/projects">
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
          </Link>
          <FolderGit2 className="h-4 w-4 text-primary" />
          <span className="font-mono font-semibold text-sm">{project.name}</span>
          {project.language && (
            <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
              {project.language}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs font-mono"
            onClick={() => gitInit.mutate({ id: projectId })}
            disabled={gitInit.isPending}
          >
            <GitBranch className="h-3 w-3 mr-1" />
            Git Init
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs font-mono"
            onClick={() => runTests.mutate({ id: projectId }, {
              onSuccess: (result) => {
                setCmdOutput(prev => [...prev, {
                  cmd: "run tests",
                  output: `Tests: ${result.passed} passed, ${result.failed} failed\n${result.output}`,
                  success: result.success,
                }]);
              },
            })}
            disabled={runTests.isPending}
          >
            <Play className="h-3 w-3 mr-1" />
            Run Tests
          </Button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="w-56 border-r border-border bg-card/30 flex flex-col">
          <div className="h-9 border-b border-border px-3 flex items-center justify-between">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
              Explorer
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => { refetchFiles(); queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(projectId) }); }}
            >
              <RefreshCw className="h-2.5 w-2.5" />
            </Button>
          </div>
          <ScrollArea className="flex-1">
            {filesLoading ? (
              <div className="p-2 space-y-1">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-5 w-full" />)}
              </div>
            ) : !files || files.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground font-mono">No files yet.</div>
            ) : (
              <div className="py-1">
                <FileTree
                  nodes={files as FileNode[]}
                  onSelect={selectFile}
                  selectedPath={selectedFile}
                />
              </div>
            )}
          </ScrollArea>
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 border-b border-border overflow-auto bg-background">
            {selectedFile ? (
              <div className="h-full flex flex-col">
                <div className="h-8 border-b border-border px-4 flex items-center bg-card/30">
                  <span className="text-xs font-mono text-muted-foreground">{selectedFile}</span>
                </div>
                <pre className="flex-1 overflow-auto p-4 text-xs font-mono leading-relaxed">
                  {readFile.isPending ? "Loading..." : fileContent}
                </pre>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground/40">
                <div className="text-center">
                  <File className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="text-xs font-mono">Select a file to view its contents</p>
                </div>
              </div>
            )}
          </div>

          <div className="h-48 flex flex-col bg-background/50">
            <div className="h-8 border-b border-border px-4 flex items-center gap-2">
              <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Terminal</span>
            </div>
            <ScrollArea className="flex-1 px-4 py-2">
              {cmdOutput.map((entry, i) => (
                <div key={i} className="mb-2">
                  <div className="font-mono text-xs text-primary/80">$ {entry.cmd}</div>
                  <pre className={`text-xs font-mono whitespace-pre-wrap ${entry.success ? "text-foreground/80" : "text-red-400/80"}`}>
                    {entry.output || "(no output)"}
                  </pre>
                </div>
              ))}
            </ScrollArea>
            <div className="border-t border-border p-2 flex gap-2">
              <span className="text-primary font-mono text-xs pt-1.5">$</span>
              <Input
                value={cmdInput}
                onChange={e => setCmdInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && runCommand()}
                placeholder="run a command..."
                className="h-7 text-xs font-mono border-0 bg-transparent focus-visible:ring-0 p-0"
              />
              <Button
                size="sm"
                className="h-7 text-xs font-mono"
                onClick={runCommand}
                disabled={executeCommand.isPending}
              >
                Run
              </Button>
            </div>
          </div>
        </div>

        <div className="w-56 border-l border-border bg-card/30 p-3 flex flex-col gap-3">
          <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Git</div>
          <Input
            value={commitMsg}
            onChange={e => setCommitMsg(e.target.value)}
            placeholder="commit message..."
            className="h-7 text-xs font-mono"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs font-mono w-full"
            onClick={() => gitCommit.mutate({ id: projectId, data: { message: commitMsg } }, {
              onSuccess: () => setCommitMsg(""),
            })}
            disabled={!commitMsg || gitCommit.isPending}
          >
            <GitCommit className="h-3 w-3 mr-1" />
            Commit
          </Button>
        </div>
      </div>
    </div>
  );
}
