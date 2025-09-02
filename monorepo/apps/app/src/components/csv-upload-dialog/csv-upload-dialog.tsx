import { useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Chip from '@mui/material/Chip';

import { Iconify } from 'src/components/iconify';
import { Upload } from 'src/components/upload/upload';
import { parseCsvFile, type CsvValidationResult, type ParsedTransaction } from 'src/utils/csv-parser';

// ----------------------------------------------------------------------

type Props = {
  open: boolean;
  onClose: () => void;
  onUpload: (transactions: ParsedTransaction[]) => void;
};

export function CsvUploadDialog({ open, onClose, onUpload }: Props) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationResult, setValidationResult] = useState<CsvValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const handleFileSelect = async (file: File) => {
    setSelectedFile(file);
    setIsValidating(true);
    
    try {
      const content = await file.text();
      const result = parseCsvFile(content);
      setValidationResult(result);
    } catch (error) {
      console.error('Error reading file:', error);
      setValidationResult({
        isValid: false,
        errors: ['Erro ao ler arquivo CSV'],
        warnings: [],
        parsedTransactions: [],
        totalRows: 0,
        validRows: 0,
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleUpload = () => {
    if (validationResult && validationResult.isValid && validationResult.parsedTransactions.length > 0) {
      onUpload(validationResult.parsedTransactions);
      handleClose();
    }
  };

  const handleClose = () => {
    setSelectedFile(null);
    setValidationResult(null);
    setIsValidating(false);
    onClose();
  };

  return (
    <Dialog 
      open={open} 
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Iconify icon="material-symbols:upload-file" />
          <Typography variant="h6">Importar Transações CSV</Typography>
        </Stack>
      </DialogTitle>

      <DialogContent>
        <Stack spacing={3}>
          <Typography variant="body2" color="text.secondary">
            Selecione um arquivo CSV com as transações que deseja importar. 
            O arquivo deve conter as colunas: <strong>nome</strong>, <strong>vencimento</strong>, <strong>valor</strong> e <strong>categoria</strong>.
            <br />
            <strong>Dica:</strong> Para vencimento, você pode usar DD/MM/AAAA, AAAA-MM-DD ou apenas o dia (ex: 15 para o dia 15 do mês atual).
          </Typography>

          <Box>
            <Upload
              value={selectedFile}
              onDrop={(acceptedFiles) => {
                if (acceptedFiles.length > 0) {
                  handleFileSelect(acceptedFiles[0]);
                }
              }}
              accept={{
                'text/csv': ['.csv'],
                'application/vnd.ms-excel': ['.csv'],
              }}
              maxSize={5 * 1024 * 1024} // 5MB
              helperText="Arquivos CSV até 5MB"
              disabled={isValidating}
            />
          </Box>

          {isValidating && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2 }}>
              <CircularProgress size={20} />
              <Typography variant="body2">Validando arquivo CSV...</Typography>
            </Box>
          )}

          {selectedFile && !isValidating && (
            <Box sx={{ p: 2, bgcolor: 'background.neutral', borderRadius: 1 }}>
              <Typography variant="subtitle2" gutterBottom>
                Arquivo selecionado:
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
              </Typography>
            </Box>
          )}

          {validationResult && (
            <>
              <Divider />
              
              {/* Validation Summary */}
              <Box sx={{ p: 2, bgcolor: 'background.neutral', borderRadius: 1 }}>
                <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="subtitle2">Resumo da Validação:</Typography>
                  <Chip 
                    label={`${validationResult.validRows}/${validationResult.totalRows} linhas válidas`}
                    color={validationResult.isValid ? 'success' : 'warning'}
                    size="small"
                  />
                </Stack>
                
                {validationResult.totalRows > 0 && (
                  <Typography variant="body2" color="text.secondary">
                    Total de transações a serem importadas: <strong>{validationResult.parsedTransactions.length}</strong>
                  </Typography>
                )}
              </Box>

              {/* Errors */}
              {validationResult.errors.length > 0 && (
                <Alert severity="error">
                  <Typography variant="subtitle2" gutterBottom>
                    Erros encontrados ({validationResult.errors.length}):
                  </Typography>
                  <Box component="ul" sx={{ m: 0, pl: 2 }}>
                    {validationResult.errors.slice(0, 5).map((error, index) => (
                      <li key={index}>
                        <Typography variant="body2">{error}</Typography>
                      </li>
                    ))}
                    {validationResult.errors.length > 5 && (
                      <li>
                        <Typography variant="body2">
                          ... e mais {validationResult.errors.length - 5} erros
                        </Typography>
                      </li>
                    )}
                  </Box>
                </Alert>
              )}

              {/* Warnings */}
              {validationResult.warnings.length > 0 && (
                <Alert severity="warning">
                  <Typography variant="subtitle2" gutterBottom>
                    Avisos:
                  </Typography>
                  <Box component="ul" sx={{ m: 0, pl: 2 }}>
                    {validationResult.warnings.map((warning, index) => (
                      <li key={index}>
                        <Typography variant="body2">{warning}</Typography>
                      </li>
                    ))}
                  </Box>
                </Alert>
              )}

              {/* Success */}
              {validationResult.isValid && validationResult.parsedTransactions.length > 0 && (
                <Alert severity="success">
                  <Typography variant="subtitle2">
                    ✅ Arquivo CSV válido! {validationResult.parsedTransactions.length} transações prontas para importação.
                  </Typography>
                </Alert>
              )}

              {/* Preview */}
              {validationResult.parsedTransactions.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    Prévia das transações ({validationResult.parsedTransactions.length}):
                  </Typography>
                  <Box sx={{ maxHeight: 300, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    {validationResult.parsedTransactions.map((transaction, index) => (
                      <Box key={index} sx={{ p: 1.5, borderBottom: index < validationResult.parsedTransactions.length - 1 ? 1 : 0, borderColor: 'divider' }}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {transaction.description}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            R$ {transaction.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </Typography>
                        </Stack>
                        <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                          <Chip label={transaction.category} size="small" variant="outlined" />
                          <Chip label={transaction.type} size="small" color="primary" />
                          <Typography variant="caption" color="text.secondary">
                            {new Date(transaction.dueAt).toLocaleDateString('pt-BR')}
                          </Typography>
                        </Stack>
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}
            </>
          )}
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} variant="outlined" color="inherit">
          Cancelar
        </Button>
        <Button 
          onClick={handleUpload} 
          variant="contained"
          disabled={!validationResult || !validationResult.isValid || validationResult.parsedTransactions.length === 0}
          startIcon={<Iconify icon="material-symbols:upload" />}
        >
          Importar {validationResult?.parsedTransactions.length ? `(${validationResult.parsedTransactions.length})` : ''}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
