import React from 'react';

interface PlaceholderProps {
  message: string;
}

export const Placeholder: React.FC<PlaceholderProps> = ({ message }) => {
  return (
    <div style={{ border: '1px dashed #ccc', padding: '1rem', marginTop: '1rem' }}>
      <p>{message}</p>
    </div>
  );
};
