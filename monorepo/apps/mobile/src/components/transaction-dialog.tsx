'use client';

import { useState } from 'react';
import { Modal, ModalContent, ModalDescription, ModalHeader, ModalTitle, ModalClose } from './ui/modal';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';
import { Card, CardContent } from './ui/card';
import { Plus, DollarSign, TrendingUp, TrendingDown, CreditCard, PiggyBank, Briefcase } from 'lucide-react';
import { WallexSubmission } from '../types';

export interface TransactionDialogProps {
  onSave: (transaction: any) => Promise<void>;
  isLoading?: boolean;
  triggerButton?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export type TransactionType = 'expense' | 'income' | 'investment';

export interface TransactionTypeConfig {
  id: TransactionType;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  fields: {
    description: { required: boolean; placeholder: string };
    amount: { required: boolean; placeholder: string };
    dueAt: { required: boolean; placeholder: string };
    status: { required: boolean; options: string[] };
    category: { required: boolean; options: string[] };
    // Additional fields for specific transaction types
    symbol?: { required: boolean; placeholder: string };
    quantity?: { required: boolean; placeholder: string };
  };
}

const transactionTypes: TransactionTypeConfig[] = [
  {
    id: 'expense',
    label: 'Expense',
    description: 'Money going out',
    icon: <TrendingDown className="h-6 w-6" />,
    color: 'text-red-600',
    fields: {
      description: { required: true, placeholder: 'e.g., Coffee, Groceries' },
      amount: { required: true, placeholder: '0.00' },
      dueAt: { required: true, placeholder: 'Due date' },
      status: { required: true, options: ['PAID', 'PENDING', 'OVERDUE', 'DRAFT'] },
      category: { required: false, options: ['food', 'transport', 'entertainment', 'shopping', 'bills', 'healthcare', 'education', 'other'] }
    }
  },
  {
    id: 'income',
    label: 'Income',
    description: 'Money coming in',
    icon: <TrendingUp className="h-6 w-6" />,
    color: 'text-green-600',
    fields: {
      description: { required: true, placeholder: 'e.g., Salary, Freelance' },
      amount: { required: true, placeholder: '0.00' },
      dueAt: { required: true, placeholder: 'Due date' },
      status: { required: true, options: ['PAID', 'PENDING', 'OVERDUE', 'DRAFT'] },
      category: { required: false, options: ['salary', 'freelance', 'business', 'gift', 'refund', 'other'] }
    }
  },
  {
    id: 'investment',
    label: 'Investment',
    description: 'Grow your wealth',
    icon: <TrendingUp className="h-6 w-6" />,
    color: 'text-blue-600',
    fields: {
      description: { required: true, placeholder: 'e.g., Stock Purchase, Crypto' },
      amount: { required: true, placeholder: '0.00' },
      dueAt: { required: true, placeholder: 'Due date' },
      status: { required: true, options: ['PAID', 'PENDING', 'OVERDUE', 'DRAFT'] },
      category: { required: false, options: ['stocks', 'crypto', 'bonds', 'real-estate', 'mutual-funds', 'etf', 'other'] },
      symbol: { required: false, placeholder: 'e.g., BTC, AAPL' },
      quantity: { required: false, placeholder: 'Quantity' }
    }
  }
];

export default function TransactionDialog({ onSave, isLoading = false, triggerButton, open: externalOpen, onOpenChange }: TransactionDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<TransactionType | null>(null);
  const [formData, setFormData] = useState<Partial<{
    description: string;
    amount: number;
    dueAt: string;
    status: string;
    category: string;
    symbol?: string;
    quantity?: number;
  }>>({});

  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;

  console.log('TransactionDialog rendered, open:', open, 'selectedType:', selectedType);

  const handleTypeSelect = (type: TransactionType) => {
    setSelectedType(type);
    setFormData({
      status: 'PENDING',
      dueAt: new Date().toISOString().split('T')[0] // Today's date
    });
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSave = async () => {
    if (!selectedType) return;

    const typeConfig = transactionTypes.find(t => t.id === selectedType);
    if (!typeConfig) return;

    // Validate required fields
    const requiredFields = Object.entries(typeConfig.fields)
      .filter(([_, config]) => config.required)
      .map(([field, _]) => field);

    const missingFields = requiredFields.filter(field => {
      if (field === 'category' || field === 'currency') return !formData[field as keyof typeof formData];
      return !formData[field as keyof typeof formData];
    });

    if (missingFields.length > 0) {
      alert(`Please fill in all required fields: ${missingFields.join(', ')}`);
      return;
    }

    try {
      const transactionData = {
        type: selectedType?.toUpperCase(),
        description: formData.description || '',
        amount: parseFloat(formData.amount?.toString() || '0'),
        status: formData.status || 'PENDING',
        dueAt: new Date(formData.dueAt || new Date()),
        category: formData.category || undefined,
        symbol: formData.symbol || undefined,
        quantity: formData.quantity ? parseFloat(formData.quantity.toString()) : undefined
      };

      await onSave(transactionData);
      setOpen(false);
      setSelectedType(null);
      setFormData({});
    } catch (error) {
      console.error('Failed to save transaction:', error);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setSelectedType(null);
    setFormData({});
  };

  const currentTypeConfig = selectedType ? transactionTypes.find(t => t.id === selectedType) : null;

  return (
    <>
      {triggerButton ? (
        <div onClick={() => setOpen(true)}>
          {triggerButton}
        </div>
      ) : (
        <Button 
          className="flex-1"
          onClick={() => {
            console.log('Button clicked, opening dialog');
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Transaction
        </Button>
      )}
      
      <Modal open={open} onOpenChange={(newOpen) => {
        console.log('Modal open state changing to:', newOpen);
        setOpen(newOpen);
      }}>
        <ModalHeader>
          <ModalTitle>
            {selectedType ? `Add ${currentTypeConfig?.label}` : 'Select Transaction Type'}
          </ModalTitle>
          <ModalDescription>
            {selectedType 
              ? `Create a new ${currentTypeConfig?.label.toLowerCase()} transaction`
              : 'Choose the type of transaction you want to create'
            }
          </ModalDescription>
          <ModalClose onClose={() => setOpen(false)} />
        </ModalHeader>
        
        <ModalContent>

        <div className="space-y-4">
          {!selectedType ? (
            // Transaction Type Selection
            <div className="space-y-3">
              {transactionTypes.map((type) => (
                <Card 
                  key={type.id} 
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => handleTypeSelect(type.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center space-x-3">
                      <div className={type.color}>
                        {type.icon}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold">{type.label}</h3>
                        <p className="text-sm text-muted-foreground">{type.description}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            // Transaction Form
            <div className="space-y-4">
              {/* Back Button */}
              <Button 
                variant="outline" 
                onClick={() => setSelectedType(null)}
                className="w-full"
              >
                ← Back to Transaction Types
              </Button>

              {/* Form Fields */}
              <div className="space-y-4">
                {/* Description */}
                <div className="space-y-2">
                  <Label htmlFor="description">
                    Description {currentTypeConfig?.fields.description.required && <span className="text-red-500">*</span>}
                  </Label>
                  <Input
                    id="description"
                    placeholder={currentTypeConfig?.fields.description.placeholder}
                    value={formData.description || ''}
                    onChange={(e) => handleInputChange('description', e.target.value)}
                  />
                </div>

                {/* Amount */}
                <div className="space-y-2">
                  <Label htmlFor="amount">
                    Amount {currentTypeConfig?.fields.amount.required && <span className="text-red-500">*</span>}
                  </Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    placeholder={currentTypeConfig?.fields.amount.placeholder}
                    value={formData.amount || ''}
                    onChange={(e) => handleInputChange('amount', e.target.value)}
                  />
                </div>

                {/* Due Date */}
                <div className="space-y-2">
                  <Label htmlFor="dueAt">
                    Due Date {currentTypeConfig?.fields.dueAt.required && <span className="text-red-500">*</span>}
                  </Label>
                  <Input
                    id="dueAt"
                    type="date"
                    placeholder={currentTypeConfig?.fields.dueAt.placeholder}
                    value={formData.dueAt || ''}
                    onChange={(e) => handleInputChange('dueAt', e.target.value)}
                  />
                </div>

                {/* Status */}
                <div className="space-y-2">
                  <Label htmlFor="status">
                    Status {currentTypeConfig?.fields.status.required && <span className="text-red-500">*</span>}
                  </Label>
                  <Select
                    value={formData.status || ''}
                    onValueChange={(value) => handleInputChange('status', value)}
                    placeholder="Select status"
                  >
                    <SelectContent>
                      {currentTypeConfig?.fields.status.options.map((option) => (
                        <SelectItem key={option} value={option} onSelect={(value) => handleInputChange('status', value)}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Category */}
                <div className="space-y-2">
                  <Label htmlFor="category">
                    Category {currentTypeConfig?.fields.category.required && <span className="text-red-500">*</span>}
                  </Label>
                  <Select
                    value={formData.category || ''}
                    onValueChange={(value) => handleInputChange('category', value)}
                    placeholder="Select category"
                  >
                    <SelectContent>
                      {currentTypeConfig?.fields.category.options.map((option) => (
                        <SelectItem key={option} value={option} onSelect={(value) => handleInputChange('category', value)}>
                          {option.charAt(0).toUpperCase() + option.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Investment-specific fields */}
                {selectedType === 'investment' && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="symbol">
                        Symbol {currentTypeConfig?.fields.symbol?.required && <span className="text-red-500">*</span>}
                      </Label>
                      <Input
                        id="symbol"
                        placeholder={currentTypeConfig?.fields.symbol?.placeholder}
                        value={formData.symbol || ''}
                        onChange={(e) => handleInputChange('symbol', e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="quantity">
                        Quantity {currentTypeConfig?.fields.quantity?.required && <span className="text-red-500">*</span>}
                      </Label>
                      <Input
                        id="quantity"
                        type="number"
                        step="0.000001"
                        placeholder={currentTypeConfig?.fields.quantity?.placeholder}
                        value={formData.quantity || ''}
                        onChange={(e) => handleInputChange('quantity', e.target.value)}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex space-x-2 pt-4">
                <Button variant="outline" onClick={handleClose} className="flex-1">
                  Cancel
                </Button>
                <Button 
                  onClick={handleSave} 
                  disabled={isLoading}
                  className="flex-1"
                >
                  {isLoading ? 'Saving...' : 'Save Transaction'}
                </Button>
              </div>
            </div>
          )}
        </div>
        </ModalContent>
      </Modal>
    </>
  );
}
